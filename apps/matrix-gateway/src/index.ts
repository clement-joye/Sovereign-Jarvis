import {
  loadBaseServiceConfig,
  loadMatrixGatewayRuntimeConfig,
  loadPlatformCatalogPath,
  SingleFlight
} from "@second-brain/configuration";
import { FileAttachmentStore } from "@second-brain/media-adapter";
import { MatrixGatewayProcessor } from "@second-brain/matrix-adapter";
import { createSecurityEventEmitter, createStructuredLogger } from "@second-brain/observability";
import {
  createPlatformAgentCatalog,
  readPlatformCatalogV2Artifact
} from "@second-brain/platform-catalog";

import { MatrixSyncClient } from "./matrix/sync/matrix-sync.js";
import {
  MatrixRoomMembershipClient,
  MatrixTrustedInviteProcessor
} from "./matrix/membership/matrix-membership.js";
import { createMatrixGatewayServer } from "./server.js";
import { sendThreadedReply } from "./matrix/sync/thread-anchor.js";
import { MatrixMediaClient } from "./matrix/media/matrix-media.js";
import { MatrixProfileTimezoneClient } from "./matrix/sessions/matrix-profile-timezone.js";
import { MatrixE2eeClient } from "./matrix/sessions/matrix-e2ee-client.js";
import { prepareInboundMediaEvent } from "./matrix/media/matrix-inbound-media.js";
import { matrixSyncFailureKind } from "./matrix/sync/matrix-sync-failure-kind.js";
import { logMatrixInboundEventFailure } from "./matrix/sync/log-matrix-inbound-event-failure.js";
import {
  deliveryError,
  DeterministicMatrixSender,
  MatrixRoomHttpSender,
  MatrixSdkRoomSender,
  type MatrixOutboundSender
} from "./matrix/outbound/matrix-outbound-sender.js";
import {
  HttpControlPlaneWorkspaceClient,
  HttpControlPlaneOutboundClient,
  HttpControlPlaneSubmitter
} from "./control-plane/control-plane-client.js";
import {
  MatrixTypingNotifier,
  noOpMatrixTypingIndicator,
  type MatrixTypingIndicator
} from "./matrix/sync/matrix-typing.js";
import { requiredEnv } from "./bootstrap/environment.js";

const config = loadBaseServiceConfig("matrix-gateway");
const runtimeConfig = loadMatrixGatewayRuntimeConfig();
const logger = createStructuredLogger({
  service: config.serviceName,
  environment: config.environment,
  version: "0.0.0"
});
const securityEvents = createSecurityEventEmitter(logger);
const platformCatalog = await readPlatformCatalogV2Artifact(loadPlatformCatalogPath(), {
  securityEvents
});
const agentCatalog = createPlatformAgentCatalog(platformCatalog.catalog);
const { port, controlBaseUrl, outboundPollMs, outboundClaimLimit, e2eeRetryMs } = runtimeConfig;
const attachmentStore = new FileAttachmentStore(
  process.env.MATRIX_EXCHANGE_ROOT ?? "/brain/exchange"
);

async function pollOutboundOnce(): Promise<void> {
  const messages = await outboundClient.claim(outboundClaimLimit);
  for (const message of messages) {
    try {
      const result = await sendThreadedReply(outboundSender, message);
      typingIndicator.stop(message.traceId);
      await outboundClient.delivered(message.id, result.externalEventId);
      logger.info("Matrix outbound delivered", {
        outbound_message_id: message.id,
        trace_id: message.traceId,
        conversation_id: message.conversationId,
        external_event_id: result.externalEventId
      });
      if (result.anchorExternalEventId && result.anchorIdempotencyKey) {
        await outboundClient.anchorDelivered(
          result.anchorIdempotencyKey,
          result.anchorExternalEventId,
          message.conversationId
        );
      }
    } catch (error) {
      const structured = deliveryError(error);
      logger.log(structured.retryable ? "warn" : "error", "Matrix outbound delivery failed", {
        outbound_message_id: message.id,
        trace_id: message.traceId,
        conversation_id: message.conversationId,
        error_code: structured.code,
        retryable: structured.retryable,
        error: structured.message
      });
      if (structured.retryable) {
        await outboundClient.retry(message.id, structured);
      } else {
        await outboundClient.fail(message.id, structured);
        typingIndicator.stop(message.traceId);
      }
    }
  }
}

const typingIndicator: MatrixTypingIndicator =
  runtimeConfig.homeserverUrl && process.env.MATRIX_ACCESS_TOKEN
    ? new MatrixTypingNotifier({
        homeserverUrl: runtimeConfig.homeserverUrl,
        accessToken: process.env.MATRIX_ACCESS_TOKEN,
        userId: requiredEnv("MATRIX_BRAIN_USER_ID", "@brain:example"),
        timeoutMs: runtimeConfig.typingTimeoutMs,
        refreshMs: runtimeConfig.typingRefreshMs,
        maxDurationMs: runtimeConfig.typingMaxDurationMs,
        onError: () => {
          logger.error("matrix typing update failed", { error_code: "matrix_typing_failed" });
        }
      })
    : noOpMatrixTypingIndicator;

const profileTimezone =
  runtimeConfig.homeserverUrl && process.env.MATRIX_ACCESS_TOKEN
    ? new MatrixProfileTimezoneClient({
        homeserverUrl: runtimeConfig.homeserverUrl,
        accessToken: process.env.MATRIX_ACCESS_TOKEN
      })
    : undefined;
const workspaceResolver = new HttpControlPlaneWorkspaceClient(controlBaseUrl);
const membershipProcessor =
  runtimeConfig.homeserverUrl && process.env.MATRIX_ACCESS_TOKEN
    ? new MatrixTrustedInviteProcessor({
        ownerMatrixId: requiredEnv("MATRIX_OWNER_ID", "@owner:example"),
        brainUserId: requiredEnv("MATRIX_BRAIN_USER_ID", "@brain:example"),
        joiner: new MatrixRoomMembershipClient(
          runtimeConfig.homeserverUrl,
          process.env.MATRIX_ACCESS_TOKEN
        ),
        inviteAccepter: new HttpControlPlaneWorkspaceClient(controlBaseUrl),
        archiver: new HttpControlPlaneWorkspaceClient(controlBaseUrl)
      })
    : undefined;
const processor = new MatrixGatewayProcessor({
  agentCatalog,
  auth: {
    ownerMatrixId: requiredEnv("MATRIX_OWNER_ID", "@owner:example"),
    brainUserId: requiredEnv("MATRIX_BRAIN_USER_ID", "@brain:example")
  },
  submitter: new HttpControlPlaneSubmitter(controlBaseUrl, typingIndicator),
  workspaceResolver,
  lifecycleCommandSubmitter: new HttpControlPlaneWorkspaceClient(controlBaseUrl),
  agentCommandSubmitter: new HttpControlPlaneWorkspaceClient(controlBaseUrl),
  pluginCommandSubmitter: new HttpControlPlaneWorkspaceClient(controlBaseUrl),
  enrichMessage: async (message) => {
    const userTimezone = profileTimezone ? await profileTimezone.get(message.senderId) : undefined;
    return userTimezone ? { ...message, userTimezone } : message;
  }
});
const outboundClient = new HttpControlPlaneOutboundClient(controlBaseUrl);
const matrixMedia = new MatrixMediaClient({
  homeserverUrl: runtimeConfig.homeserverUrl ?? "http://localhost:8008",
  accessToken: process.env.MATRIX_ACCESS_TOKEN ?? "",
  maxDownloadBytes: runtimeConfig.maxMediaBytes
});
const e2eeClient =
  process.env.MATRIX_E2EE_ENABLED === "true" &&
  runtimeConfig.homeserverUrl &&
  process.env.MATRIX_ACCESS_TOKEN
    ? new MatrixE2eeClient({
        homeserverUrl: runtimeConfig.homeserverUrl,
        accessToken: process.env.MATRIX_ACCESS_TOKEN,
        cryptoStorePath: process.env.MATRIX_CRYPTO_STORE_PATH ?? "/brain/matrix-crypto",
        ...(process.env.MATRIX_RECOVERY_KEY
          ? { recoveryKey: process.env.MATRIX_RECOVERY_KEY }
          : {}),
        processor,
        ...(membershipProcessor ? { membershipProcessor } : {}),
        prepareEvent: prepareInboundMediaEvent(matrixMedia, attachmentStore),
        onError: () => {
          logger.error("matrix E2EE processing failed", { error_code: "matrix_e2ee_failed" });
        },
        onProcessed: (result) => {
          const workspaceId =
            result && typeof result === "object" && "workspaceId" in result
              ? (result as { workspaceId?: string }).workspaceId
              : undefined;
          const scoped = workspaceId ? logger.withContext({ workspace_id: workspaceId }) : logger;
          scoped.info("matrix inbound event processed", { result });
        }
      })
    : undefined;
const outboundSender: MatrixOutboundSender = e2eeClient
  ? new MatrixSdkRoomSender(e2eeClient, matrixMedia, attachmentStore)
  : runtimeConfig.homeserverUrl && process.env.MATRIX_ACCESS_TOKEN
    ? new MatrixRoomHttpSender(
        runtimeConfig.homeserverUrl,
        process.env.MATRIX_ACCESS_TOKEN,
        matrixMedia,
        attachmentStore
      )
    : new DeterministicMatrixSender();
const syncClient =
  !e2eeClient && runtimeConfig.homeserverUrl && process.env.MATRIX_ACCESS_TOKEN
    ? new MatrixSyncClient({
        homeserverUrl: runtimeConfig.homeserverUrl,
        accessToken: process.env.MATRIX_ACCESS_TOKEN,
        processor,
        ...(membershipProcessor ? { membershipProcessor } : {}),
        prepareEvent: prepareInboundMediaEvent(
          new MatrixMediaClient({
            homeserverUrl: runtimeConfig.homeserverUrl,
            accessToken: process.env.MATRIX_ACCESS_TOKEN,
            maxDownloadBytes: runtimeConfig.maxMediaBytes
          }),
          attachmentStore
        ),
        onEventFailure: (failure) => logMatrixInboundEventFailure(logger, failure)
      })
    : undefined;

let shuttingDown = false;
let e2eeRetryTimer: ReturnType<typeof setTimeout> | undefined;
const outboundPoller = new SingleFlight<void>();
const outboundInterval = setInterval(() => {
  void outboundPoller.run(pollOutboundOnce).catch(() => {
    logger.error("Matrix outbound poll failed", { error_code: "control_plane_unavailable" });
  });
}, outboundPollMs);

const syncPoller = new SingleFlight<void>();
const syncInterval = syncClient
  ? setInterval(() => {
      void syncPoller
        .run(() => syncClient.syncOnce())
        .catch((error: unknown) => {
          logger.error("Matrix sync failed", {
            error_code: "matrix_sync_failed",
            failure_kind: matrixSyncFailureKind(error)
          });
        });
    }, runtimeConfig.syncPollMs)
  : undefined;

if (e2eeClient) {
  void startE2eeWithRetry(e2eeClient);
}

async function startE2eeWithRetry(client: MatrixE2eeClient): Promise<void> {
  if (shuttingDown) return;
  try {
    await client.start();
    if (shuttingDown) {
      client.stop();
      return;
    }
    logger.info("matrix E2EE started");
  } catch {
    if (shuttingDown) return;
    logger.error("matrix E2EE startup failed", {
      error_code: "matrix_e2ee_start_failed",
      retryInMs: e2eeRetryMs
    });
    e2eeRetryTimer = setTimeout(() => void startE2eeWithRetry(client), e2eeRetryMs);
  }
}

const server = createMatrixGatewayServer({
  processor,
  serviceName: config.serviceName,
  version: "0.0.0",
  catalogDigest: platformCatalog.catalog.digest,
  ...(platformCatalog.catalog.policyDigest
    ? { policyDigest: platformCatalog.catalog.policyDigest }
    : {}),
  controlBaseUrl
});

server.listen(port, () => {
  logger.info("matrix gateway started", {
    port,
    controlBaseUrl,
    catalogDigest: platformCatalog.catalog.digest
  });
});

function beginShutdown(signal: "SIGINT" | "SIGTERM"): void {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(outboundInterval);
  if (syncInterval) clearInterval(syncInterval);
  if (e2eeRetryTimer) clearTimeout(e2eeRetryTimer);
  typingIndicator.stopAll?.();
  e2eeClient?.stop();
  logger.info("matrix gateway shutting down", { signal });
  server.close(() => {
    void Promise.all([outboundPoller.waitForIdle(30_000), syncPoller.waitForIdle(30_000)]).then(
      () => {
        logger.info("matrix gateway stopped", { signal });
      }
    );
  });
}

process.once("SIGINT", () => beginShutdown("SIGINT"));
process.once("SIGTERM", () => beginShutdown("SIGTERM"));

export { createMatrixGatewayServer } from "./server.js";
export type { MatrixGatewayHttpProcessor } from "./server.js";
export {
  HttpControlPlaneSubmitter,
  HttpControlPlaneOutboundClient
} from "./control-plane/control-plane-client.js";
export { noOpMatrixTypingIndicator } from "./matrix/sync/matrix-typing.js";
export type { MatrixTypingIndicator } from "./matrix/sync/matrix-typing.js";
