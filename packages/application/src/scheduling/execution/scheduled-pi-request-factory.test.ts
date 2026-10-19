import { describe, expect, it } from "vitest";

import type { ScheduledExecutionV1, ScheduledJobV1 } from "@second-brain/contracts";
import { INITIAL_AGENT_CATALOG, type SessionRecord } from "@second-brain/domain";

import { ScheduledPiRequestFactory } from "./scheduled-pi-request-factory.js";
import { SCHEDULE_SILENCE_TOKEN } from "../policy/schedule-silence-protocol.js";

describe("ScheduledPiRequestFactory", () => {
  it("builds a background request bound to the execution and resolved session", () => {
    const factory = new ScheduledPiRequestFactory({
      ids: { nextId: () => "pi-run-1" },
      agentCatalog: INITIAL_AGENT_CATALOG
    });

    const request = factory.create(schedule(), execution(), session());

    expect(request).toEqual(
      expect.objectContaining({
        id: "pi-run-1",
        agentId: "brain",
        traceId: "schedule:execution-1",
        sessionId: "session-1",
        userTimezone: "Europe/Stockholm",
        timeoutSeconds: 60,
        priority: "background",
        sourceReferences: [
          expect.objectContaining({ conversationId: "!default:example", attachmentIds: [] })
        ]
      })
    );
  });

  it("augments the prompt with the silence protocol but keeps the raw instruction in sourceReferences", () => {
    const factory = new ScheduledPiRequestFactory({
      ids: { nextId: () => "pi-run-1" },
      agentCatalog: INITIAL_AGENT_CATALOG
    });

    const request = factory.create(schedule(), execution(), session());

    // The model sees the instruction plus the silence protocol appended.
    expect(request.inputText).toContain("Summarize the day.");
    expect(request.inputText).toContain(SCHEDULE_SILENCE_TOKEN);
    expect(request.inputText).toMatch(/SILENCE PROTOCOL/);
    // The audit trail keeps the author's raw instruction.
    expect(request.sourceReferences[0]?.textExcerpt).toBe("Summarize the day.");
  });

  it("uses the schedule-owned room instead of the legacy default room", () => {
    const factory = new ScheduledPiRequestFactory({
      ids: { nextId: () => "pi-run-1" },
      agentCatalog: INITIAL_AGENT_CATALOG
    });

    const request = factory.create(
      { ...schedule(), workspaceId: "workspace-b", destinationConversationId: "!room-b:example" },
      execution(),
      session()
    );

    expect(request.sourceReferences[0]?.conversationId).toBe("!room-b:example");
    expect(request.workspaceId).toBe("workspace-b");
  });

  it("uses the schedule's persisted executor", () => {
    const factory = new ScheduledPiRequestFactory({
      ids: { nextId: () => "pi-run-1" },
      agentCatalog: INITIAL_AGENT_CATALOG
    });

    expect(
      factory.create({ ...schedule(), agentId: "browser" }, execution(), session()).agentId
    ).toBe("browser");
  });

  it("bounds a persisted schedule timeout by its selected agent policy", () => {
    const factory = new ScheduledPiRequestFactory({
      ids: { nextId: () => "pi-run-1" },
      agentCatalog: INITIAL_AGENT_CATALOG
    });

    const request = factory.create(
      { ...schedule(), agentId: "orchestrator", timeoutSeconds: 4000 },
      execution(),
      session()
    );

    expect(request.timeoutSeconds).toBe(3200);
  });
});

function schedule(): ScheduledJobV1 {
  return {
    schemaVersion: 1,
    id: "schedule-1",
    workspaceId: "workspace-example",
    agentId: "brain",
    name: "Daily summary",
    instruction: "Summarize the day.",
    destinationConversationId: "!default:example",
    schedule: { type: "cron", expression: "0 9 * * *", timezone: "Europe/Stockholm" },
    enabled: true,
    sessionPolicy: { type: "fresh" },
    notificationPolicy: "always",
    overlapPolicy: "skip",
    missedRunPolicy: "skip",
    timeoutSeconds: 60,
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function execution(): ScheduledExecutionV1 {
  return {
    schemaVersion: 1,
    id: "execution-1",
    scheduleId: "schedule-1",
    scheduledFor: "2026-01-01T09:00:00.000Z",
    status: "running",
    attempt: 1,
    createdAt: "2026-01-01T09:00:00.000Z"
  };
}

function session(): SessionRecord {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: "session-1",
    label: "Schedule",
    status: "active",
    createdAt: now,
    lastActiveAt: now,
    idleExpiresAt: now,
    absoluteExpiresAt: now,
    piSessionKey: "scheduled:session-1",
    sourceType: "scheduled",
    sourceConversationId: "!default:example",
    sourceScheduleId: "schedule-1"
  };
}
