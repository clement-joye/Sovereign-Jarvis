import { describe, expect, it, vi } from "vitest";

import type { ScheduledExecutionV1, ScheduledJobV1 } from "@second-brain/contracts";
import type { SessionRecord } from "@second-brain/domain";

import { ConversationSessionHandler } from "../../sessions/presentation/conversation-session-handler.js";
import { parseScheduledExecutionId, ScheduleAnchorBinder } from "./schedule-anchor-binding.js";

describe("parseScheduledExecutionId", () => {
  it.each([
    ["run_schedule:execution-1:outbound:anchor", "execution-1"],
    ["run_schedule:abc-123:outbound:anchor", "abc-123"],
    [
      "run_schedule:execution-schedule-d1adc152-57c1-4eb2-b2c5-f6ed052c4428-2026-08-01T14:58:23.000Z:outbound:anchor",
      "execution-schedule-d1adc152-57c1-4eb2-b2c5-f6ed052c4428-2026-08-01T14:58:23.000Z"
    ],
    ["run_schedule:execution-1:outbound", undefined],
    ["run_schedule::outbound:anchor", undefined],
    ["some_other_prefix:execution-1:outbound:anchor", undefined],
    ["", undefined]
  ] as const)("parses %s as %s", (input, expected) => {
    expect(parseScheduledExecutionId(input)).toBe(expected);
  });
});

describe("ScheduleAnchorBinder", () => {
  it("activates the binding between the schedule session and the anchor thread", async () => {
    const sessionRecord = session();
    const executionRecord = execution({ sessionId: sessionRecord.id });
    const sessions = {
      get: vi.fn().mockResolvedValue(sessionRecord),
      activateBinding: vi.fn().mockResolvedValue(sessionRecord)
    };
    const executions = { get: vi.fn().mockResolvedValue(executionRecord) };
    const schedules = { get: vi.fn().mockResolvedValue(schedule()) };

    const result = await new ScheduleAnchorBinder(sessions, executions, schedules).bind({
      anchorIdempotencyKey: `run_schedule:${executionRecord.id}:outbound:anchor`,
      anchorExternalEventId: "$anchor-event-1",
      conversationId: "!room:example"
    });

    expect(result).toEqual({ bound: true, executionId: executionRecord.id });
    expect(sessions.activateBinding).toHaveBeenCalledWith({
      sessionId: sessionRecord.id,
      workspaceId: "workspace-1",
      conversationId: "!room:example",
      threadRootExternalEventId: "$anchor-event-1"
    });
    expect(sessions.get).toHaveBeenCalledWith(sessionRecord.id, "workspace-1");
  });

  it("returns bound=false when the anchor idempotency key is not a schedule anchor", async () => {
    const sessions = { get: vi.fn(), activateBinding: vi.fn() };
    const executions = { get: vi.fn() };
    const schedules = { get: vi.fn() };

    const result = await new ScheduleAnchorBinder(sessions, executions, schedules).bind({
      anchorIdempotencyKey: "other_prefix:foo:anchor",
      anchorExternalEventId: "$anchor-event-1",
      conversationId: "!room:example"
    });

    expect(result).toEqual({ bound: false });
    expect(executions.get).not.toHaveBeenCalled();
    expect(sessions.activateBinding).not.toHaveBeenCalled();
  });

  it("returns bound=false when the execution record is missing", async () => {
    const executions = { get: vi.fn().mockResolvedValue(undefined) };
    const sessions = { get: vi.fn(), activateBinding: vi.fn() };
    const schedules = { get: vi.fn() };

    const result = await new ScheduleAnchorBinder(sessions, executions, schedules).bind({
      anchorIdempotencyKey: "run_schedule:missing:outbound:anchor",
      anchorExternalEventId: "$anchor-event-1",
      conversationId: "!room:example"
    });

    expect(result).toEqual({ bound: false, executionId: "missing" });
    expect(sessions.activateBinding).not.toHaveBeenCalled();
  });

  it("returns bound=false when the execution has no session id", async () => {
    const executionRecord = execution({ sessionId: undefined });
    const executions = { get: vi.fn().mockResolvedValue(executionRecord) };
    const sessions = { get: vi.fn(), activateBinding: vi.fn() };
    const schedules = { get: vi.fn().mockResolvedValue(schedule()) };

    const result = await new ScheduleAnchorBinder(sessions, executions, schedules).bind({
      anchorIdempotencyKey: `run_schedule:${executionRecord.id}:outbound:anchor`,
      anchorExternalEventId: "$anchor-event-1",
      conversationId: "!room:example"
    });

    expect(result).toEqual({ bound: false, executionId: executionRecord.id });
    expect(sessions.get).not.toHaveBeenCalled();
    expect(sessions.activateBinding).not.toHaveBeenCalled();
  });

  it("returns bound=false when the recorded session is missing", async () => {
    const executionRecord = execution({ sessionId: "session-gone" });
    const executions = { get: vi.fn().mockResolvedValue(executionRecord) };
    const sessions = { get: vi.fn().mockResolvedValue(undefined), activateBinding: vi.fn() };
    const schedules = { get: vi.fn().mockResolvedValue(schedule()) };

    const result = await new ScheduleAnchorBinder(sessions, executions, schedules).bind({
      anchorIdempotencyKey: `run_schedule:${executionRecord.id}:outbound:anchor`,
      anchorExternalEventId: "$anchor-event-1",
      conversationId: "!room:example"
    });

    expect(result).toEqual({ bound: false, executionId: executionRecord.id });
    expect(sessions.activateBinding).not.toHaveBeenCalled();
  });

  it("resumes the scheduled execution session when the user replies in its thread", async () => {
    const sessionRecord = {
      ...session(),
      idleExpiresAt: new Date("2026-07-27T10:01:00.000Z"),
      absoluteExpiresAt: new Date("2026-07-27T11:00:00.000Z")
    };
    const executionRecord = execution({ sessionId: sessionRecord.id });
    let threadSession: SessionRecord | undefined;
    const sessions = {
      get: vi.fn().mockResolvedValue(sessionRecord),
      activateBinding: vi.fn(async () => {
        threadSession = sessionRecord;
        return sessionRecord;
      }),
      getActiveBinding: vi.fn().mockImplementation(async () => threadSession),
      touch: vi.fn().mockResolvedValue(sessionRecord),
      createAndBind: vi.fn()
    };
    const binder = new ScheduleAnchorBinder(
      sessions,
      { get: vi.fn().mockResolvedValue(executionRecord) },
      { get: vi.fn().mockResolvedValue(schedule()) }
    );
    await binder.bind({
      anchorIdempotencyKey: `run_schedule:${executionRecord.id}:outbound:anchor`,
      anchorExternalEventId: "$anchor-event-1",
      conversationId: "!room:example"
    });

    const handler = new ConversationSessionHandler(
      sessions,
      { now: () => new Date("2026-07-27T10:00:00.000Z") },
      { nextId: () => "new-session" },
      { idleContinuationMs: 60_000, retentionMs: 3_600_000 }
    );
    const resolution = await handler.resolve({
      schemaVersion: 1,
      id: "inbound-1",
      traceId: "trace-1",
      transport: "matrix",
      externalEventId: "$reply-event-1",
      conversationId: "!room:example",
      senderId: "@user:example",
      receivedAt: "2026-07-27T10:00:00.000Z",
      kind: "text",
      text: "Continue this report",
      attachments: [],
      threadRootExternalEventId: "$anchor-event-1",
      metadata: {}
    });

    expect(resolution).toMatchObject({
      sessionId: sessionRecord.id,
      created: false,
      mode: "thread"
    });
    expect(sessions.createAndBind).not.toHaveBeenCalled();
  });
});

function execution(overrides: Partial<ScheduledExecutionV1> = {}): ScheduledExecutionV1 {
  return {
    schemaVersion: 1,
    id: "execution-1",
    scheduleId: "schedule-1",
    scheduledFor: "2026-07-27T10:00:00.000Z",
    status: "succeeded",
    attempt: 1,
    sessionId: "session-1",
    createdAt: "2026-07-27T10:00:00.000Z",
    startedAt: "2026-07-27T10:00:00.000Z",
    finishedAt: "2026-07-27T10:00:01.000Z",
    ...overrides
  };
}

function session(): SessionRecord {
  const now = new Date("2026-07-27T10:00:00.000Z");
  return {
    id: "session-1",
    label: "Daily summary",
    status: "active",
    createdAt: now,
    lastActiveAt: now,
    idleExpiresAt: now,
    absoluteExpiresAt: now,
    piSessionKey: "fresh:schedule-1",
    sourceType: "scheduled",
    sourceConversationId: "!default:example",
    sourceScheduleId: "schedule-1"
  };
}

function schedule(): ScheduledJobV1 {
  return {
    schemaVersion: 1,
    id: "schedule-1",
    workspaceId: "workspace-1",
    agentId: "scheduler",
    name: "Daily summary",
    instruction: "Summarize the day",
    schedule: { type: "once", runAt: "2026-07-27T10:00:00.000Z" },
    enabled: true,
    sessionPolicy: { type: "fresh" },
    notificationPolicy: "always",
    overlapPolicy: "skip",
    missedRunPolicy: "run_once",
    timeoutSeconds: 600,
    nextRunAt: "2026-07-27T10:00:00.000Z",
    version: 1,
    createdAt: "2026-07-27T09:00:00.000Z",
    updatedAt: "2026-07-27T09:00:00.000Z"
  };
}
