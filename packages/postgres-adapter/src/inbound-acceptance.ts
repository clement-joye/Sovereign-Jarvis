import {
  inboundJobIdempotencyKey,
  inboundRequiresRootAdmission,
  type InboundAcceptanceResult
} from "@second-brain/application";
import type { InboundMessageV1, InternalJobV1 } from "@second-brain/contracts/schemas";
import { requireWorkspaceId, type IdGeneratorPort } from "@second-brain/domain";

import { PostgresInboundMessageRepository } from "./repositories/inbound-message-repository.js";
import { PostgresJobQueue } from "./job-queue.js";
import { withTransaction, type PostgresTransactionSource } from "./transaction.js";

export type { PostgresTransactionalClient, PostgresTransactionSource } from "./transaction.js";

export interface PostgresInboundAcceptanceServiceOptions {
  db: PostgresTransactionSource;
  ids: IdGeneratorPort;
  now: () => Date;
}

export class PostgresInboundAcceptanceService {
  private readonly db: PostgresTransactionSource;
  private readonly ids: IdGeneratorPort;
  private readonly now: () => Date;

  constructor(options: PostgresInboundAcceptanceServiceOptions) {
    this.db = options.db;
    this.ids = options.ids;
    this.now = options.now;
  }

  async acceptMatrixInbound(message: InboundMessageV1): Promise<InboundAcceptanceResult> {
    return withTransaction(this.db, async (client) => {
      const inboundMessages = new PostgresInboundMessageRepository({ db: client });
      const jobs = new PostgresJobQueue({ db: client });
      const stored = await inboundMessages.create(message);
      const cancelTarget =
        !stored.duplicate && stored.message.text?.trim() === "/cancel"
          ? await jobs.cancelLatestInboundTurn({
              workspaceId: requireWorkspaceId(stored.message.workspaceId),
              conversationId: stored.message.conversationId,
              ...(stored.message.threadRootExternalEventId
                ? { threadRootExternalEventId: stored.message.threadRootExternalEventId }
                : {}),
              excludeInboundMessageId: stored.message.id
            })
          : undefined;
      const job = await jobs.enqueue(this.toJob(stored.message, cancelTarget));
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
    });
  }

  private toJob(
    message: InboundMessageV1,
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
      idempotencyKey: inboundJobIdempotencyKey(message)
    };
  }
}
