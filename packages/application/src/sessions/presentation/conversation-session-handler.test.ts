import { describe, expect, it, vi } from "vitest";

import { exampleInboundMessage } from "@second-brain/contracts";
import type { SessionRecord } from "@second-brain/domain";

import { ConversationSessionHandler } from "./conversation-session-handler.js";

describe("ConversationSessionHandler", () => {
  it("creates and binds a new default-room session", async () => {
    const sessions = repository();
    const handler = createHandler(sessions);

    await expect(handler.resolve(exampleInboundMessage)).resolves.toMatchObject({
      sessionId: "session-1",
      mode: "default-room"
    });
    expect(sessions.createAndBind).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({ id: "session-1", label: "Remember this note." }),
        conversationId: exampleInboundMessage.conversationId
      })
    );
    expect(sessions.activateBinding).toHaveBeenCalledWith({
      sessionId: "session-1",
      workspaceId: "workspace-example",
      conversationId: exampleInboundMessage.conversationId,
      threadRootExternalEventId: exampleInboundMessage.externalEventId
    });
  });

  it("touches an active labeled session when resuming it", async () => {
    const active = session();
    const sessions = repository(active);
    const handler = createHandler(sessions);

    await expect(handler.resolve(exampleInboundMessage)).resolves.toMatchObject({
      sessionId: active.id,
      mode: "default-room"
    });
    expect(sessions.touch).toHaveBeenCalledWith({
      sessionId: active.id,
      workspaceId: "workspace-example",
      now: new Date("2026-07-27T10:00:00.000Z")
    });
    expect(sessions.createAndBind).not.toHaveBeenCalled();
  });
});

function createHandler(sessions: ReturnType<typeof repository>): ConversationSessionHandler {
  return new ConversationSessionHandler(
    sessions,
    { now: () => new Date("2026-07-27T10:00:00.000Z") },
    { nextId: () => "session-1" },
    { idleContinuationMs: 60_000, retentionMs: 3_600_000 }
  );
}

function repository(activeSession?: SessionRecord) {
  return {
    activateBinding: vi.fn().mockResolvedValue(undefined),
    createAndBind: vi.fn().mockResolvedValue(undefined),
    getActiveBinding: vi.fn().mockResolvedValue(activeSession),
    touch: vi.fn().mockResolvedValue(activeSession)
  };
}

function session(): SessionRecord {
  const now = new Date("2026-07-27T10:00:00.000Z");
  return {
    id: "session-1",
    workspaceId: "workspace-example",
    label: "Existing session",
    status: "active",
    createdAt: now,
    lastActiveAt: now,
    idleExpiresAt: new Date("2026-07-27T10:01:00.000Z"),
    absoluteExpiresAt: new Date("2026-07-27T11:00:00.000Z"),
    piSessionKey: "session-1",
    sourceType: "default-room",
    sourceConversationId: exampleInboundMessage.conversationId
  };
}
