import type { InboundMessageV1, SessionResolutionV1 } from "@second-brain/contracts";
import {
  resolveInboundSession,
  type IdGeneratorPort,
  type SessionRecord
} from "@second-brain/domain";
import type { ClockPort } from "@second-brain/domain";

import type { SessionRepositoryPort } from "../../ports.js";
import { normalizeSessionLabel } from "./session-presentation.js";

/** Resolves, persists, and binds sessions for non-command inbound messages. */
export class ConversationSessionHandler {
  constructor(
    private readonly sessions: Pick<
      SessionRepositoryPort,
      "activateBinding" | "createAndBind" | "getActiveBinding" | "touch"
    >,
    private readonly clock: ClockPort,
    private readonly ids: IdGeneratorPort,
    private readonly timing: { idleContinuationMs: number; retentionMs: number }
  ) {}

  async resolve(message: InboundMessageV1): Promise<SessionResolutionV1> {
    const activeSession = await this.sessions.getActiveBinding(bindingKey(message));
    const decision = resolveInboundSession(
      {
        conversationId: message.conversationId,
        ...optionalThread(message),
        ...(activeSession ? { activeSession } : {}),
        idleContinuationMs: this.timing.idleContinuationMs,
        retentionMs: this.timing.retentionMs
      },
      this.clock,
      this.ids
    );
    const now = this.clock.now();

    if (decision.command === "resume") {
      if (!activeSession)
        throw new Error("Session routing resolved a resume without an active session.");
      const inferredLabel = normalizeSessionLabel(message.text);
      if (!activeSession.label?.trim() && inferredLabel) {
        await this.sessions.createAndBind({
          session: {
            ...activeSession,
            ...((message.workspaceId ?? activeSession.workspaceId)
              ? { workspaceId: message.workspaceId ?? activeSession.workspaceId }
              : {}),
            label: inferredLabel,
            lastActiveAt: now,
            idleExpiresAt: new Date(now.getTime() + this.timing.idleContinuationMs)
          },
          conversationId: message.conversationId,
          ...(message.workspaceId ? { workspaceId: message.workspaceId } : {}),
          ...(message.agentId ? { agentId: message.agentId } : {}),
          ...optionalThread(message)
        });
      } else {
        await this.sessions.touch({
          sessionId: decision.resolution.sessionId,
          ...(message.workspaceId ? { workspaceId: message.workspaceId } : {}),
          now
        });
      }
      await this.bindReplyThread(message, decision.resolution.sessionId);
      return decision.resolution;
    }

    await this.sessions.createAndBind({
      session: toSessionRecord(decision.resolution, {
        now,
        idleContinuationMs: this.timing.idleContinuationMs,
        text: message.text,
        workspaceId: message.workspaceId
      }),
      conversationId: message.conversationId,
      ...(message.workspaceId ? { workspaceId: message.workspaceId } : {}),
      ...(message.agentId ? { agentId: message.agentId } : {}),
      ...optionalThread(message)
    });
    await this.bindReplyThread(message, decision.resolution.sessionId);
    return decision.resolution;
  }

  private async bindReplyThread(message: InboundMessageV1, sessionId: string): Promise<void> {
    if (message.threadRootExternalEventId) return;
    await this.sessions.activateBinding({
      sessionId,
      ...(message.workspaceId ? { workspaceId: message.workspaceId } : {}),
      ...(message.agentId ? { agentId: message.agentId } : {}),
      conversationId: message.conversationId,
      threadRootExternalEventId: message.externalEventId
    });
  }
}

function bindingKey(message: InboundMessageV1): {
  workspaceId?: string;
  conversationId: string;
  threadRootExternalEventId?: string;
} {
  return {
    ...(message.workspaceId ? { workspaceId: message.workspaceId } : {}),
    ...(message.agentId ? { agentId: message.agentId } : {}),
    conversationId: message.conversationId,
    ...optionalThread(message)
  };
}

function optionalThread(message: InboundMessageV1): { threadRootExternalEventId?: string } {
  return message.threadRootExternalEventId
    ? { threadRootExternalEventId: message.threadRootExternalEventId }
    : {};
}

function toSessionRecord(
  resolution: SessionResolutionV1,
  context: {
    now: Date;
    idleContinuationMs: number;
    text: string | undefined;
    workspaceId: string | undefined;
  }
): SessionRecord {
  const label = normalizeSessionLabel(context.text);
  return {
    id: resolution.sessionId,
    ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
    ...(label ? { label } : {}),
    status: "active",
    createdAt: context.now,
    lastActiveAt: context.now,
    idleExpiresAt: new Date(context.now.getTime() + context.idleContinuationMs),
    absoluteExpiresAt: new Date(resolution.expiresAt),
    piSessionKey: resolution.sessionId,
    sourceType: resolution.mode === "thread" ? "thread" : "default-room",
    ...(resolution.sourceConversationId
      ? { sourceConversationId: resolution.sourceConversationId }
      : {}),
    ...(resolution.sourceThreadRootId ? { sourceThreadRootId: resolution.sourceThreadRootId } : {})
  };
}
