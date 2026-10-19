import type {
  BrainWorkerConfig,
  RuntimeProvisionerClientConfig
} from "@second-brain/configuration";
import {
  SessionRoutingService,
  WorkerOrchestrationService,
  WorkspaceWriteLeaseService,
  type WorkerOrchestrationOptions
} from "@second-brain/application";
import type { AgentCatalog, IdGeneratorPort } from "@second-brain/domain";
import type { StructuredLogger } from "@second-brain/observability";

import { HttpApprovalCommandHandler } from "./clients/control-plane/control-plane-approval-command-client.js";
import { HttpJobQueue } from "./clients/control-plane/control-plane-job-client.js";
import { HttpInboundMessageRepository } from "./clients/control-plane/control-plane-inbound-client.js";
import { HttpExecutionRepository } from "./clients/control-plane/control-plane-execution-client.js";
import { HttpScheduleRepository } from "./clients/control-plane/control-plane-schedule-client.js";
import { HttpSessionRepository } from "./clients/control-plane/control-plane-session-client.js";
import { HttpConversationPreferenceRepository } from "./clients/control-plane/control-plane-preference-client.js";
import {
  HttpAgentCollaborationRepository,
  HttpWorkspaceWriteLeaseRepository
} from "./clients/control-plane/control-plane-collaboration-client.js";
import {
  HttpOutboundJobCompletion,
  HttpOutboundRepository
} from "./clients/control-plane/control-plane-outbound-client.js";
import { HttpMediaProcessor } from "./clients/media/media-worker-client.js";
import { createWorkerPiRunner } from "./orchestration/workspace-pi-runner.js";

export interface WorkerCompositionOptions {
  readonly workerConfig: BrainWorkerConfig;
  readonly workerId: string;
  readonly ids: IdGeneratorPort;
  readonly agentCatalog: AgentCatalog;
  readonly logger: StructuredLogger;
  readonly runtimeProvisioner?: RuntimeProvisionerClientConfig;
  readonly currentRuntimeProfilePath?: string;
}

export function createWorkerOrchestrationService(
  options: WorkerCompositionOptions
): WorkerOrchestrationService {
  const { workerConfig, workerId, ids, agentCatalog, logger } = options;
  const sessions = new HttpSessionRepository(
    workerConfig.controlUrl,
    workerConfig.controlRequestTimeoutMs
  );
  const preferences = new HttpConversationPreferenceRepository(
    workerConfig.controlUrl,
    workerConfig.controlRequestTimeoutMs
  );
  const schedules = new HttpScheduleRepository(
    workerConfig.controlUrl,
    workerConfig.controlRequestTimeoutMs
  );
  const collaborationToken = workerConfig.workerCollaborationToken;
  const collaboration = collaborationToken
    ? createCollaboration(workerConfig, collaborationToken)
    : undefined;
  const writeLeases =
    collaboration && collaborationToken
      ? new WorkspaceWriteLeaseService(
          new HttpWorkspaceWriteLeaseRepository(
            workerConfig.controlUrl,
            collaborationToken,
            workerConfig.controlRequestTimeoutMs,
            collaboration
          ),
          ids,
          { now: () => new Date() }
        )
      : undefined;

  const workerOptions: WorkerOrchestrationOptions = {
    jobs: new HttpJobQueue(workerConfig.controlUrl, workerConfig.controlRequestTimeoutMs),
    inboundMessages: new HttpInboundMessageRepository(
      workerConfig.controlUrl,
      workerConfig.controlRequestTimeoutMs
    ),
    sessions,
    preferences,
    schedules,
    executions: new HttpExecutionRepository(
      workerConfig.controlUrl,
      workerConfig.controlRequestTimeoutMs
    ),
    outbounds: new HttpOutboundRepository(
      workerConfig.controlUrl,
      workerConfig.controlRequestTimeoutMs
    ),
    outboundCompletions: new HttpOutboundJobCompletion(
      workerConfig.controlUrl,
      workerConfig.controlRequestTimeoutMs
    ),
    sessionRouting: new SessionRoutingService({
      sessions,
      preferences,
      schedules,
      approvalCommands: new HttpApprovalCommandHandler(
        workerConfig.controlUrl,
        workerConfig.controlRequestTimeoutMs
      ),
      clock: { now: () => new Date() },
      ids,
      agentCatalog,
      config: {
        idleContinuationMs: workerConfig.sessionIdleContinuationMs,
        retentionMs: workerConfig.sessionRetentionMs,
        scheduleDisplayTimezone: workerConfig.sessionDisplayTimezone
      }
    }),
    pi: createWorkerPiRunner({
      ...(options.runtimeProvisioner ? { runtimeProvisioner: options.runtimeProvisioner } : {}),
      ...(options.currentRuntimeProfilePath
        ? { currentRuntimeProfilePath: options.currentRuntimeProfilePath }
        : {})
    }),
    activeCatalog: agentCatalog,
    media: new HttpMediaProcessor(workerConfig.mediaWorkerUrl, workerConfig.mediaRequestTimeoutMs),
    ...(collaboration ? { collaboration, runAuthorization: collaboration } : {}),
    ...(writeLeases ? { writeLeases } : {}),
    ids,
    clock: { now: () => new Date() },
    onJobFailure: ({ jobId, jobType, error }) => {
      logger.error(error instanceof Error ? error.message : "Unknown worker error.", {
        worker_id: workerId,
        job_id: jobId,
        job_type: jobType
      });
    },
    config: {
      workerId,
      leaseMs: workerConfig.leaseMs,
      claimLimit: workerConfig.claimLimit,
      jobTypes: workerConfig.jobTypes,
      maxAttempts: workerConfig.maxAttempts,
      retryBaseDelayMs: workerConfig.retryBaseDelayMs,
      piTimeoutSeconds: workerConfig.piTimeoutSeconds
    }
  };

  return new WorkerOrchestrationService(workerOptions);
}

function createCollaboration(
  workerConfig: BrainWorkerConfig,
  collaborationToken: string
): HttpAgentCollaborationRepository | undefined {
  return new HttpAgentCollaborationRepository(
    workerConfig.controlUrl,
    collaborationToken,
    workerConfig.controlRequestTimeoutMs
  );
}
