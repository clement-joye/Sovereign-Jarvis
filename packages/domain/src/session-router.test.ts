import { describe, expect, it } from "vitest";
import {
  evaluateSessionExpiry,
  parseSessionCommand,
  resolveInboundSession,
  type SessionRecord
} from "./session-router.js";

class TestClock {
  constructor(private readonly timestamp: string) {}

  now(): Date {
    return new Date(this.timestamp);
  }
}

class TestIds {
  private next = 1;

  nextId(prefix: string): string {
    const id = `${prefix}-${this.next}`;
    this.next += 1;
    return id;
  }
}

describe("session router", () => {
  it("creates a default room session when no binding exists", () => {
    const decision = resolveInboundSession(
      {
        conversationId: "!room:example",
        idleContinuationMs: 86_400_000,
        retentionMs: 604_800_000
      },
      new TestClock("2026-07-17T15:00:00.000Z"),
      new TestIds()
    );

    expect(decision.command).toBe("create-and-bind");
    expect(decision.resolution).toMatchObject({
      sessionId: "session-1",
      mode: "default-room",
      created: true
    });
  });

  it("resumes a recent thread session", () => {
    const activeSession: SessionRecord = {
      id: "session-existing",
      status: "active",
      createdAt: new Date("2026-07-17T14:00:00.000Z"),
      lastActiveAt: new Date("2026-07-17T14:30:00.000Z"),
      idleExpiresAt: new Date("2026-07-18T14:30:00.000Z"),
      absoluteExpiresAt: new Date("2026-07-24T14:00:00.000Z"),
      piSessionKey: "session-existing",
      sourceType: "thread"
    };

    const decision = resolveInboundSession(
      {
        conversationId: "!room:example",
        threadRootExternalEventId: "$root",
        activeSession,
        idleContinuationMs: 86_400_000,
        retentionMs: 604_800_000
      },
      new TestClock("2026-07-17T15:00:00.000Z"),
      new TestIds()
    );

    expect(decision.command).toBe("resume");
    expect(decision.resolution).toMatchObject({
      sessionId: "session-existing",
      mode: "thread",
      created: false,
      sourceThreadRootId: "$root"
    });
  });

  it("parses deterministic control commands", () => {
    expect(parseSessionCommand("/help")).toEqual({ type: "help" });
    expect(parseSessionCommand("/help plugins")).toEqual({ type: "help", section: "plugins" });
    expect(parseSessionCommand("/new project notes")).toEqual({
      type: "new",
      label: "project notes"
    });
    expect(parseSessionCommand("/session fresh")).toEqual({ type: "session-fresh" });
    expect(parseSessionCommand("/session history 8")).toEqual({
      type: "session-history",
      limit: 8
    });
    expect(parseSessionCommand("/session default")).toEqual({ type: "session-default" });
    expect(parseSessionCommand("/session status")).toEqual({ type: "session-status" });
    expect(parseSessionCommand("/cancel")).toEqual({ type: "cancel" });
    expect(parseSessionCommand("/approve action-proposal-1")).toEqual({
      type: "approve",
      proposalId: "action-proposal-1"
    });
    expect(parseSessionCommand("/reject action_proposal_2")).toEqual({
      type: "reject",
      proposalId: "action_proposal_2"
    });
    expect(parseSessionCommand("/yes")).toEqual({ type: "approve-reply" });
    expect(parseSessionCommand("/no")).toEqual({ type: "reject-reply" });
    expect(parseSessionCommand("/close 2")).toEqual({ type: "close", selectors: ["2"] });
    expect(parseSessionCommand("/close 1 2 3")).toEqual({
      type: "close",
      selectors: ["1", "2", "3"]
    });
    expect(parseSessionCommand("/sessions close")).toEqual({ type: "close-all" });
    expect(parseSessionCommand("/schedules")).toEqual({ type: "schedules" });
    expect(parseSessionCommand("/schedule 2")).toEqual({ type: "schedule", selector: "2" });
    expect(parseSessionCommand("/schedule 2 run")).toEqual({ type: "schedule-run", selector: "2" });
    expect(parseSessionCommand("/schedule delete 2 3")).toEqual({
      type: "schedule-delete",
      selectors: ["2", "3"]
    });
    expect(parseSessionCommand("/voice")).toEqual({ type: "voice" });
    expect(parseSessionCommand("/voice on")).toEqual({ type: "voice", enabled: true });
    expect(parseSessionCommand("/voice off")).toEqual({ type: "voice", enabled: false });
    expect(parseSessionCommand("/fork")).toEqual({
      type: "invalid",
      message: "Unsupported command: /fork"
    });
    expect(parseSessionCommand("hello")).toEqual({ type: "not-command" });
  });

  it("preserves command-specific argument errors", () => {
    expect(parseSessionCommand("/help now")).toEqual({
      type: "invalid",
      message:
        "/help accepts one of: sessions, approvals, schedules, preferences, agents, plugins, workspace."
    });
    expect(parseSessionCommand("/help plugins extra")).toEqual({
      type: "invalid",
      message:
        "/help accepts one of: sessions, approvals, schedules, preferences, agents, plugins, workspace."
    });
    expect(parseSessionCommand("/sessions now")).toEqual({
      type: "invalid",
      message: "/sessions accepts only `close`."
    });
    expect(parseSessionCommand("/schedules now")).toEqual({
      type: "invalid",
      message: "/schedules does not accept arguments."
    });
    expect(parseSessionCommand("/cancel later")).toEqual({
      type: "invalid",
      message: "/cancel does not accept arguments."
    });
    expect(parseSessionCommand("/yes please")).toEqual({
      type: "invalid",
      message: "/yes does not accept arguments."
    });
    expect(parseSessionCommand("/approve")).toEqual({
      type: "invalid",
      message: "/approve requires exactly one proposal ID: /approve <proposal-id>."
    });
    expect(parseSessionCommand("/reject first second")).toEqual({
      type: "invalid",
      message: "/reject requires exactly one proposal ID: /reject <proposal-id>."
    });
    expect(parseSessionCommand("/approve ../secret")).toEqual({
      type: "invalid",
      message:
        "/approve received an unsafe proposal ID. Use only letters, numbers, underscore, or hyphen (up to 128 characters)."
    });
    expect(parseSessionCommand(`/reject ${"a".repeat(129)}`)).toEqual({
      type: "invalid",
      message:
        "/reject received an unsafe proposal ID. Use only letters, numbers, underscore, or hyphen (up to 128 characters)."
    });
    expect(parseSessionCommand("/voice maybe")).toEqual({
      type: "invalid",
      message: "/voice accepts only `on` or `off`."
    });
    expect(parseSessionCommand("/session")).toEqual({
      type: "invalid",
      message: "/session accepts `fresh`, `history <0-100>`, `default`, or `status`."
    });
    expect(parseSessionCommand("/session history 101")).toEqual({
      type: "invalid",
      message: "/session accepts `fresh`, `history <0-100>`, `default`, or `status`."
    });
  });

  it("evaluates idle and absolute expiry under injected time", () => {
    const session: SessionRecord = {
      id: "session-existing",
      status: "active",
      createdAt: new Date("2026-07-17T14:00:00.000Z"),
      lastActiveAt: new Date("2026-07-17T14:30:00.000Z"),
      idleExpiresAt: new Date("2026-07-18T14:30:00.000Z"),
      absoluteExpiresAt: new Date("2026-07-24T14:00:00.000Z"),
      piSessionKey: "session-existing",
      sourceType: "default-room"
    };

    expect(
      evaluateSessionExpiry(session, new Date("2026-07-17T15:00:00.000Z"), 86_400_000)
    ).toEqual({ expired: false });
    expect(
      evaluateSessionExpiry(session, new Date("2026-07-19T15:00:00.000Z"), 86_400_000)
    ).toEqual({ expired: true, reason: "idle" });
    expect(
      evaluateSessionExpiry(session, new Date("2026-07-24T14:00:00.000Z"), 86_400_000)
    ).toEqual({ expired: true, reason: "absolute" });
  });
});
