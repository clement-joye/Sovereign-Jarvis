import { describe, expect, it, vi } from "vitest";

import { exampleInboundMessage } from "@second-brain/contracts";
import type { SessionRecord } from "@second-brain/domain";

import { SessionLifecycleCommandHandler } from "./session-lifecycle-command-handler.js";

describe("SessionLifecycleCommandHandler", () => {
  it("rejects non-numbered selected-session closures before repository access", async () => {
    const sessions = repository([session()]);
    const handler = createHandler(sessions, vi.fn());

    await expect(
      handler.closeSelected(exampleInboundMessage, ["not-a-number"])
    ).resolves.toMatchObject({
      command: "close",
      text: expect.stringContaining("Use `/sessions` to find a number")
    });
    expect(sessions.listRecent).not.toHaveBeenCalled();
  });

  it("does not use a stale thread session as the cancellation target", async () => {
    const sessions = repository([session()]);
    sessions.getActiveBinding.mockResolvedValue(session());
    const handler = createHandler(sessions, vi.fn());

    await expect(handler.cancel(exampleInboundMessage)).resolves.toMatchObject({
      command: "cancel",
      text: "Cancellation requested."
    });
    expect(sessions.getActiveBinding).not.toHaveBeenCalled();
  });
});

function createHandler(
  sessions: ReturnType<typeof repository>,
  bindReplyThread: ReturnType<typeof vi.fn>
): SessionLifecycleCommandHandler {
  return new SessionLifecycleCommandHandler(
    sessions,
    { now: () => new Date("2026-07-27T10:00:00.000Z") },
    bindReplyThread
  );
}

function repository(records: SessionRecord[]) {
  return {
    activateBinding: vi.fn().mockResolvedValue(records[0]),
    close: vi.fn().mockResolvedValue(records[0]),
    get: vi.fn().mockResolvedValue(records[0]),
    getActiveBinding: vi.fn(),
    listRecent: vi.fn().mockResolvedValue(records)
  };
}

function session(): SessionRecord {
  const now = new Date("2026-07-27T10:00:00.000Z");
  return {
    id: "session-1",
    label: "Session",
    status: "active",
    createdAt: now,
    lastActiveAt: now,
    idleExpiresAt: now,
    absoluteExpiresAt: new Date("2026-07-28T10:00:00.000Z"),
    piSessionKey: "session-1",
    sourceType: "default-room",
    sourceConversationId: exampleInboundMessage.conversationId
  };
}
