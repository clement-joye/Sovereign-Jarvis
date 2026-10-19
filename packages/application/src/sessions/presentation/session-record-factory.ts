import type { InboundMessageV1 } from "@second-brain/contracts";
import type { ClockPort, IdGeneratorPort, SessionRecord } from "@second-brain/domain";

export interface SessionTimingPolicy {
  idleContinuationMs: number;
  retentionMs: number;
}

/** Creates session records with consistent identities, timing, and source metadata. */
export class SessionRecordFactory {
  constructor(
    private readonly clock: ClockPort,
    private readonly ids: IdGeneratorPort,
    private readonly timing: SessionTimingPolicy
  ) {}

  create(message: InboundMessageV1, label: string | undefined): SessionRecord {
    const now = this.clock.now();
    const sessionId = this.ids.nextId("session");
    return {
      id: sessionId,
      ...(message.workspaceId ? { workspaceId: message.workspaceId } : {}),
      ...(message.agentId ? { agentId: message.agentId } : {}),
      ...(label ? { label } : {}),
      status: "active",
      createdAt: now,
      lastActiveAt: now,
      idleExpiresAt: new Date(now.getTime() + this.timing.idleContinuationMs),
      absoluteExpiresAt: new Date(now.getTime() + this.timing.retentionMs),
      piSessionKey: sessionId,
      sourceType: message.threadRootExternalEventId ? "thread" : "default-room",
      sourceConversationId: message.conversationId,
      ...(message.threadRootExternalEventId
        ? { sourceThreadRootId: message.threadRootExternalEventId }
        : {})
    };
  }
}
