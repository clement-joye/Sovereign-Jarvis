import type {
  DeliveryResultV1,
  InternalJobV1,
  OutboundMessageV1,
  PiRunRequestV1,
  PiRunResultV1
} from "@second-brain/contracts";
import type { WorkspaceRuntimeDescriptor, WorkspaceRuntimeHealth } from "@second-brain/domain";
export interface JobQueuePort {
  enqueue(job: InternalJobV1): Promise<InternalJobV1>;
  /** Cancels a queued interactive turn, or returns a running turn for Pi cancellation. */
  cancelLatestInboundTurn?(input: {
    workspaceId: string;
    conversationId: string;
    threadRootExternalEventId?: string;
    excludeInboundMessageId: string;
  }): Promise<{ runId: string; needsPiCancel: boolean } | undefined>;
  claim(input: {
    workerId: string;
    limit: number;
    now: Date;
    leaseMs: number;
    jobTypes?: InternalJobV1["type"][];
    /** Brain Control policy. When present, model-backed roots are admitted atomically. */
    rootAdmission?: { limit: number; leaseMs: number };
  }): Promise<InternalJobV1[]>;
  renew?(input: {
    jobId: string;
    leaseOwner: string;
    now: Date;
    leaseMs: number;
    admissionLeaseMs?: number;
  }): Promise<boolean>;
  cancelRootRun?(input: { rootRunId: string; now: Date; reason: string }): Promise<number>;
  hasLiveRootAdmission?(rootRunId: string, now: Date): Promise<boolean>;
  complete(input: { jobId: string; leaseOwner: string }): Promise<void>;
  fail(input: {
    jobId: string;
    leaseOwner: string;
    now: Date;
    retryable: boolean;
    reason: string;
    retryDelayMs?: number;
    maxAttempts: number;
  }): Promise<InternalJobV1>;
}

export interface RootRunAdmissionSnapshot {
  limit: number;
  activeRoots: number;
  queueDepth: number;
  oldestWaitingRoot?: { jobId: string; availableAt: string; waitMs: number };
  waitingSchedules: number;
  roots: Array<{
    rootRunId: string;
    rootJobId: string;
    workspaceId: string;
    leaseOwner: string;
    acquiredAt: string;
    heartbeatAt: string;
    expiresAt: string;
    leaseAgeMs: number;
  }>;
}
export interface OutboundRepositoryPort {
  create(message: OutboundMessageV1): Promise<OutboundMessageV1>;
  get(id: string): Promise<OutboundMessageV1 | undefined>;
  getByIdempotencyKey(
    idempotencyKey: string,
    workspaceId?: string
  ): Promise<OutboundMessageV1 | undefined>;
}
export interface OutboundJobCompletionPort {
  createOutboundAndComplete(input: {
    outbound: OutboundMessageV1;
    jobId: string;
    leaseOwner: string;
  }): Promise<OutboundMessageV1>;
}
export interface OutboundDeliveryPort {
  claim(input: {
    transport: DeliveryResultV1["transport"];
    now: Date;
    limit: number;
  }): Promise<OutboundMessageV1[]>;
  markDelivered(input: {
    outboundMessageId: string;
    transport: DeliveryResultV1["transport"];
    externalEventId: string;
    now: Date;
  }): Promise<DeliveryResultV1>;
  markRetry(input: {
    outboundMessageId: string;
    transport: DeliveryResultV1["transport"];
    now: Date;
    error: DeliveryResultV1["error"];
  }): Promise<DeliveryResultV1>;
  markFailed(input: {
    outboundMessageId: string;
    transport: DeliveryResultV1["transport"];
    now: Date;
    error: DeliveryResultV1["error"];
  }): Promise<DeliveryResultV1>;
}
export interface PiRunnerPort {
  run(request: PiRunRequestV1): Promise<PiRunResultV1>;
  cancel(runId: string): Promise<void>;
  cancelSession(sessionId: string): Promise<void>;
}
export interface ActiveCatalogDigestPort {
  readonly catalogDigest: string;
}
export interface WorkspaceRuntimePort {
  resolve(workspaceId: string): Promise<WorkspaceRuntimeDescriptor | undefined>;
  provision(input: {
    workspaceId: string;
    templateId: string;
    templateVersion: string;
    configuration: Record<string, unknown>;
  }): Promise<WorkspaceRuntimeDescriptor>;
  run(input: {
    workspaceId: string;
    request: Omit<PiRunRequestV1, "workspaceId">;
  }): Promise<PiRunResultV1>;
  cancel(workspaceId: string): Promise<void>;
  health(workspaceId: string): Promise<WorkspaceRuntimeHealth>;
  archive(workspaceId: string): Promise<void>;
  destroy(workspaceId: string): Promise<void>;
}
