import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  loadBaseServiceConfig,
  loadBrainWorkerConfig,
  loadPlatformCatalogPath,
  loadRuntimeProvisionerClientConfig,
  SingleFlight
} from "@second-brain/configuration";
import type { IdGeneratorPort } from "@second-brain/domain";
import { createSecurityEventEmitter, createStructuredLogger } from "@second-brain/observability";
import {
  createPlatformAgentCatalog,
  readPlatformCatalogV2Artifact
} from "@second-brain/platform-catalog";

import { checkUpstreamReadiness } from "./http/upstream-readiness.js";
import { createWorkerOrchestrationService } from "./worker-composition.js";
import { createWorkerInstanceId } from "./worker-identity.js";

const workerConfig = loadBrainWorkerConfig();
const workerRole = process.env.BRAIN_WORKER_ROLE ?? "brain-worker";
// Lease ownership is process-specific. A role labels a service; it must never
// double as the identity used to claim, renew, or complete durable jobs.
const workerId = createWorkerInstanceId(workerRole);
const config = loadBaseServiceConfig(workerRole);
const logger = createStructuredLogger({
  service: config.serviceName,
  environment: config.environment,
  version: "0.0.0"
});
const securityEvents = createSecurityEventEmitter(logger);

class UuidIdGenerator implements IdGeneratorPort {
  nextId(prefix: string): string {
    return `${prefix}-${randomUUID()}`;
  }
}

async function main(): Promise<void> {
  const platformCatalog = await readPlatformCatalogV2Artifact(loadPlatformCatalogPath(), {
    securityEvents
  });
  const agentCatalog = createPlatformAgentCatalog(platformCatalog.catalog);
  const poller = new SingleFlight<void>();
  const ids = new UuidIdGenerator();
  const runtimeProvisioner = loadRuntimeProvisionerClientConfig();
  const worker = createWorkerOrchestrationService({
    workerConfig,
    workerId,
    ids,
    agentCatalog,
    logger,
    ...(runtimeProvisioner ? { runtimeProvisioner } : {}),
    ...(process.env.RUNTIME_CURRENT_PROFILE_PATH
      ? { currentRuntimeProfilePath: process.env.RUNTIME_CURRENT_PROFILE_PATH }
      : {})
  });

  const upstream = await checkUpstreamReadiness(
    workerConfig,
    platformCatalog.catalog.digest,
    platformCatalog.catalog.policyDigest,
    logger
  );
  logger.info("brain-worker started", {
    ...upstream.envelope,
    worker_role: workerRole,
    worker_id: workerId
  });

  const tick = async (): Promise<void> => {
    const result = await worker.pollOnce();
    if (result.claimed > 0 || result.failed > 0) {
      logger.log(result.failed > 0 ? "warn" : "info", "brain-worker poll completed", result);
    }
  };

  if (process.env.BRAIN_WORKER_ONCE === "true") {
    await poller.run(tick);
    return;
  }

  const interval = setInterval(() => {
    void poller.run(tick).catch((error: unknown) => {
      logger.error(error instanceof Error ? error.message : "Unknown brain-worker error.");
    });
  }, workerConfig.pollIntervalMs);

  function beginShutdown(signal: "SIGINT" | "SIGTERM"): void {
    clearInterval(interval);
    logger.info("brain-worker shutting down", { signal });
    void poller.waitForIdle(30_000).then(() => {
      logger.info("brain-worker stopped", { signal });
    });
  }

  process.once("SIGINT", () => beginShutdown("SIGINT"));
  process.once("SIGTERM", () => beginShutdown("SIGTERM"));
}

if (!isEntrypoint()) {
  // Module imported for tests; do not run main().
} else {
  await main();
}

function isEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}

export { HttpJobQueue } from "./clients/control-plane/control-plane-job-client.js";
export { HttpInboundMessageRepository } from "./clients/control-plane/control-plane-inbound-client.js";
export {
  HttpOutboundRepository,
  HttpOutboundJobCompletion
} from "./clients/control-plane/control-plane-outbound-client.js";
export { HttpScheduleRepository } from "./clients/control-plane/control-plane-schedule-client.js";
export { HttpSessionRepository } from "./clients/control-plane/control-plane-session-client.js";
export { HttpExecutionRepository } from "./clients/control-plane/control-plane-execution-client.js";
export { HttpConversationPreferenceRepository } from "./clients/control-plane/control-plane-preference-client.js";
export {
  HttpAgentCollaborationRepository,
  HttpWorkspaceWriteLeaseRepository
} from "./clients/control-plane/control-plane-collaboration-client.js";
export { checkUpstreamReadiness } from "./http/upstream-readiness.js";
export { HttpPiRunner } from "./clients/pi/pi-runner-client.js";
