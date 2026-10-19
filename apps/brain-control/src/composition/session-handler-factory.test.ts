import { describe, expect, it, vi } from "vitest";

import { exampleInboundMessage } from "@second-brain/contracts";

import { buildSessionHandlers } from "./session-handler-factory.js";

function stubSessionRepository() {
  return {
    create: vi.fn(),
    createAndBind: vi.fn(),
    activateBinding: vi.fn(),
    get: vi.fn(),
    getActiveBinding: vi.fn(),
    listRecent: vi.fn(),
    close: vi.fn(),
    touch: vi.fn()
  };
}

function stubScheduleRepository() {
  return {
    create: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    claimDue: vi.fn(),
    hardDeleteDisabledOlderThan: vi.fn()
  };
}

describe("buildSessionHandlers", () => {
  it("returns the bound handler set that SessionRoutingService consumes", () => {
    const sessions = stubSessionRepository();
    const preferences = { getVoiceReplies: vi.fn(), setVoiceReplies: vi.fn() };
    const schedules = stubScheduleRepository();
    const handlers = buildSessionHandlers({
      sessions,
      preferences,
      schedules,
      clock: { now: () => new Date() },
      ids: { nextId: () => "id" },
      config: {
        sessionIdleContinuationMs: 1_000,
        sessionRetentionMs: 2_000,
        scheduleDisplayTimezone: "UTC"
      }
    });

    expect(handlers.voicePreferences).toBeDefined();
    expect(handlers.scheduleCommands).toBeDefined();
    expect(handlers.lifecycleCommands).toBeDefined();
    expect(handlers.overviewCommands).toBeDefined();
    expect(handlers.conversations).toBeDefined();
  });

  it("threads the inbound message through to the sessions repository via bindReplyThread", async () => {
    const sessions = stubSessionRepository();
    const handlers = buildSessionHandlers({
      sessions,
      preferences: undefined,
      schedules: undefined,
      clock: { now: () => new Date() },
      ids: { nextId: () => "id" },
      config: {
        sessionIdleContinuationMs: 1_000,
        sessionRetentionMs: 2_000,
        scheduleDisplayTimezone: "UTC"
      }
    });

    const topLevelMessage = {
      ...exampleInboundMessage,
      id: "inbound-thread-test",
      externalEventId: "$event-thread-test",
      threadRootExternalEventId: undefined
    };

    const result = await handlers.lifecycleCommands.closeCurrent(topLevelMessage);

    // closeCurrent returns the standard "nothing to close" message because
    // the stub has no active binding; what matters for this test is that
    // bindReplyThread was reachable through the handler chain.
    expect(result).toMatchObject({ kind: "command-response", command: "close" });
    expect(sessions.getActiveBinding).toHaveBeenCalled();
  });
});
