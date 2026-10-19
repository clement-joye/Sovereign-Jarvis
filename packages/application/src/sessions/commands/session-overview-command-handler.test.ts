import { describe, expect, it, vi } from "vitest";

import { exampleInboundMessage } from "@second-brain/contracts";
import type { SessionRecord } from "@second-brain/domain";

import { SessionOverviewCommandHandler } from "./session-overview-command-handler.js";
import { SessionRecordFactory } from "../presentation/session-record-factory.js";

describe("SessionOverviewCommandHandler", () => {
  it("creates and binds a named session before binding the reply thread", async () => {
    const sessions = repository();
    const bindReplyThread = vi.fn().mockResolvedValue(undefined);
    const handler = createHandler(sessions, bindReplyThread);

    await expect(handler.create(exampleInboundMessage, "Project notes")).resolves.toMatchObject({
      command: "new",
      sessionId: "session-1",
      text: "New session: Project notes"
    });
    expect(sessions.createAndBind).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({ id: "session-1", label: "Project notes" }),
        conversationId: exampleInboundMessage.conversationId
      })
    );
    expect(bindReplyThread).toHaveBeenCalledWith(exampleInboundMessage, "session-1");
  });

  it("lists recent non-closed sessions", async () => {
    const sessions = repository();
    sessions.listRecent.mockResolvedValue([session()]);
    const handler = createHandler(sessions, vi.fn());

    await expect(handler.list(exampleInboundMessage)).resolves.toMatchObject({
      command: "sessions",
      text: expect.stringContaining("Session")
    });
    expect(sessions.listRecent).toHaveBeenCalledWith({
      workspaceId: "workspace-example",
      now: new Date("2026-07-27T10:00:00.000Z"),
      limit: 10,
      includeClosed: false
    });
  });
});

function createHandler(
  sessions: ReturnType<typeof repository>,
  bindReplyThread: ReturnType<typeof vi.fn>
): SessionOverviewCommandHandler {
  return new SessionOverviewCommandHandler(
    sessions,
    new SessionRecordFactory(
      { now: () => new Date("2026-07-27T10:00:00.000Z") },
      { nextId: () => "session-1" },
      { idleContinuationMs: 60_000, retentionMs: 3_600_000 }
    ),
    () => new Date("2026-07-27T10:00:00.000Z"),
    bindReplyThread
  );
}

function repository() {
  return {
    createAndBind: vi.fn().mockResolvedValue(session()),
    listRecent: vi.fn()
  };
}

function session(): SessionRecord {
  const now = new Date("2026-07-27T10:00:00.000Z");
  return {
    id: "session-1",
    workspaceId: "workspace-example",
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
