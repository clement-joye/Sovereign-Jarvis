import type { InternalJobV1 } from "@second-brain/contracts";
import type { AgentCatalog, ClockPort, IdGeneratorPort } from "@second-brain/domain";

import type {
  AgentCollaborationRepositoryPort,
  ConversationPreferencePort,
  ExecutionRepositoryPort,
  InboundMessageRepositoryPort,
  JobQueuePort,
  MediaProcessorPort,
  OutboundJobCompletionPort,
  OutboundRepositoryPort,
  PiRunnerPort,
  ScheduleRepositoryPort,
  SessionRepositoryPort
} from "../ports.js";
import type { SessionRoutingPort } from "../sessions/routing/session-routing-port.js";
import type { WorkspaceWriteLeaseService } from "../workspaces/runtime/workspace-write-lease-service.js";

export interface WorkerOrchestrationConfig {
  workerId: string;
  leaseMs: number;
  claimLimit: number;
  jobTypes: InternalJobV1["type"][];
  maxAttempts: number;
  retryBaseDelayMs: number;
  piTimeoutSeconds: number;
}

export interface WorkerOrchestrationOptions {
  jobs: JobQueuePort;
  inboundMessages: InboundMessageRepositoryPort;
  sessions: SessionRepositoryPort;
  preferences?: ConversationPreferencePort;
  schedules: ScheduleRepositoryPort;
  executions: ExecutionRepositoryPort;
  outbounds: OutboundRepositoryPort;
  outboundCompletions?: OutboundJobCompletionPort;
  sessionRouting: SessionRoutingPort;
  pi: PiRunnerPort;
  media: MediaProcessorPort;
  ids: IdGeneratorPort;
  clock: ClockPort;
  config: WorkerOrchestrationConfig;
  /** Reports a job failure before it is persisted for retry or dead-lettering. */
  onJobFailure?: (input: { jobId: string; jobType: InternalJobV1["type"]; error: unknown }) => void;
  collaboration?: AgentCollaborationRepositoryPort;
  writeLeases?: Pick<WorkspaceWriteLeaseService, "acquire" | "release">;
  runAuthorization?: { run<T>(token: string, action: () => Promise<T>): Promise<T> };
  activeCatalog: AgentCatalog;
}
