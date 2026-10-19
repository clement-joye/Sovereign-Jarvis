import type { InboundMessageV1, InternalJobV1 } from "@second-brain/contracts";
import {
  parseSessionCommand,
  requireWorkspaceId,
  type IdGeneratorPort
} from "@second-brain/domain";

import type { InboundMessageRepositoryPort, JobQueuePort } from "../../ports.js";

export interface InboundAcceptanceResult {
  inboundMessageId: string;
  duplicate: boolean;
  jobId: string;
  /** Internal cancellation target; never included in the public response. */
  cancelTargetRunId?: string;
  /** Internal flag; a queued target was already cancelled in the job queue. */
  cancelTargetNeedsPiCancel?: boolean;
}

export interface InboundAcceptanceServiceOptions {
  inboundMessages: InboundMessageRepositoryPort;
  jobs: JobQueuePort;
  ids: IdGeneratorPort;
  now: () => Date;
}

export class InboundAcceptanceService {
  private readonly inboundMessages: InboundMessageRepositoryPort;
  private readonly jobs: JobQueuePort;
  private readonly ids: IdGeneratorPort;
  private readonly now: () => Date;

  constructor(options: InboundAcceptanceServiceOptions) {
    this.inboundMessages = options.inboundMessages;
    this.jobs = options.jobs;
    this.ids = options.ids;
    this.now = options.now;
  }

  async acceptMatrixInbound(message: InboundMessageV1): Promise<InboundAcceptanceResult> {
    const stored = await this.inboundMessages.create(message);
    const idempotencyKey = inboundJobIdempotencyKey(stored.message);
    const cancelTarget =
      !stored.duplicate && stored.message.text?.trim() === "/cancel"
        ? await this.jobs.cancelLatestInboundTurn?.({
            workspaceId: requireWorkspaceId(stored.message.workspaceId),
            conversationId: stored.message.conversationId,
            ...(stored.message.threadRootExternalEventId
              ? { threadRootExternalEventId: stored.message.threadRootExternalEventId }
              : {}),
            excludeInboundMessageId: stored.message.id
          })
        : undefined;
    const job = await this.jobs.enqueue(this.toJob(stored.message, idempotencyKey, cancelTarget));
    const acceptedTarget = job.payload.cancelTargetRunId;

    return {
      inboundMessageId: stored.message.id,
      duplicate: stored.duplicate,
      jobId: job.id,
      ...(typeof acceptedTarget === "string" ? { cancelTargetRunId: acceptedTarget } : {}),
      ...(typeof job.payload.cancelTargetNeedsPiCancel === "boolean"
        ? { cancelTargetNeedsPiCancel: job.payload.cancelTargetNeedsPiCancel }
        : {})
    };
  }

  private toJob(
    message: InboundMessageV1,
    idempotencyKey: string,
    cancelTarget?: { runId: string; needsPiCancel: boolean }
  ): InternalJobV1 {
    return {
      schemaVersion: 1,
      id: this.ids.nextId("job"),
      workspaceId: requireWorkspaceId(message.workspaceId, "Inbound acceptance"),
      type: "process_inbound",
      payload: {
        inboundMessageId: message.id,
        agentId: message.agentId ?? "brain",
        transport: message.transport,
        externalEventId: message.externalEventId,
        requiresRootAdmission: inboundRequiresRootAdmission(message),
        ...(cancelTarget
          ? {
              cancelTargetRunId: cancelTarget.runId,
              cancelTargetNeedsPiCancel: cancelTarget.needsPiCancel
            }
          : {})
      },
      priority: 100,
      status: "pending",
      attempts: 0,
      availableAt: this.now().toISOString(),
      idempotencyKey
    };
  }
}

/** Trusted control-plane classification; model-visible code cannot override admission. */
export function inboundRequiresRootAdmission(message: InboundMessageV1): boolean {
  if (message.text && parseSessionCommand(message.text).type !== "not-command") return false;
  if (message.text?.trim() && !message.threadRootExternalEventId) return false;
  return true;
}

export function inboundJobIdempotencyKey(message: InboundMessageV1): string {
  return `${requireWorkspaceId(message.workspaceId, "Inbound idempotency")}:${message.transport}:${message.externalEventId}:process_inbound`;
}
