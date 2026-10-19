import { describe, expect, it, vi } from "vitest";

import {
  exampleAttachment,
  exampleScheduledJob,
  type InternalJobV1,
  type PiRunResultV1,
  type ScheduledExecutionV1
} from "@second-brain/contracts";
import type { SessionRecord } from "@second-brain/domain";

import { ScheduleJobHandler } from "./schedule-job-handler.js";
import { SCHEDULE_SILENCE_TOKEN } from "../policy/schedule-silence-protocol.js";
import { TerminalWorkerError } from "../../workers/worker-errors.js";

describe("ScheduleJobHandler", () => {
  it("completes a terminal execution without resolving a session or running Pi", async () => {
    const subject = createSubject({ execution: execution({ status: "succeeded" }) });

    await subject.handler.process(job());

    expect(subject.jobs.complete).toHaveBeenCalledWith({ jobId: "job-1", leaseOwner: "worker-1" });
    expect(subject.sessions.resolve).not.toHaveBeenCalled();
    expect(subject.pi.run).not.toHaveBeenCalled();
  });

  it("skips a leased execution when its schedule was disabled during room archival", async () => {
    const subject = createSubject({ schedule: { ...exampleScheduledJob, enabled: false } });

    await subject.handler.process(job());

    expect(subject.lifecycle.skip).toHaveBeenCalledWith(execution());
    expect(subject.sessions.resolve).not.toHaveBeenCalled();
    expect(subject.pi.run).not.toHaveBeenCalled();
    expect(subject.jobs.complete).toHaveBeenCalledWith({ jobId: "job-1", leaseOwner: "worker-1" });
  });

  it("completes without an outbound when the notification policy declines", async () => {
    const subject = createSubject({ shouldNotify: false });

    await subject.handler.process(job());

    expect(subject.lifecycle.start).toHaveBeenCalledWith(execution(), session());
    expect(subject.lifecycle.finish).toHaveBeenCalledWith(subject.running, subject.result);
    expect(subject.jobs.complete).toHaveBeenCalledWith({ jobId: "job-1", leaseOwner: "worker-1" });
    expect(subject.outbounds.createAndComplete).not.toHaveBeenCalled();
  });

  it("creates an outbound notification when policy requires it", async () => {
    const subject = createSubject({ shouldNotify: true });

    await subject.handler.process(job());

    expect(subject.outbounds.createAndComplete).toHaveBeenCalledWith(
      job(),
      expect.objectContaining({
        idempotencyKey: "run_schedule:execution-1:outbound",
        traceId: "trace-1",
        conversationId: "!room:example",
        text: "**@brain**\n\nPi response"
      })
    );
    expect(subject.jobs.complete).not.toHaveBeenCalled();
  });

  it("threads the scheduled reply under a per-schedule anchor marker", async () => {
    const subject = createSubject({ shouldNotify: true });

    await subject.handler.process(job());

    expect(subject.outbounds.createAndComplete).toHaveBeenCalledWith(
      job(),
      expect.objectContaining({
        threadAnchorText: "_scheduled_ — Daily review · @brain"
      })
    );
  });

  it("delivers a scheduled reply into its saved Matrix thread without a new anchor", async () => {
    const subject = createSubject({
      shouldNotify: true,
      schedule: {
        ...exampleScheduledJob,
        destinationThreadRootExternalEventId: "$existing-thread:example"
      }
    });

    await subject.handler.process(job());

    const outbound = subject.outbounds.createAndComplete.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(outbound).toMatchObject({
      conversationId: "!room:example",
      replyToExternalEventId: "$existing-thread:example",
      threadRootExternalEventId: "$existing-thread:example"
    });
    expect(outbound).not.toHaveProperty("threadAnchorText");
  });

  it("rejects a missing schedule as terminal", async () => {
    const subject = createSubject({ schedule: undefined });

    await expect(subject.handler.process(job())).rejects.toEqual(
      new TerminalWorkerError("Unknown schedule: schedule-1")
    );
  });

  it("suppresses the chat notification when the model emits the silence token", async () => {
    const subject = createSubject({
      shouldNotify: true,
      result: result({ status: "completed", text: SCHEDULE_SILENCE_TOKEN, generatedFiles: [] })
    });

    await subject.handler.process(job());

    expect(subject.lifecycle.finish).toHaveBeenCalledWith(subject.running, subject.result);
    expect(subject.notifications.shouldNotify).not.toHaveBeenCalled();
    expect(subject.outbounds.createAndComplete).not.toHaveBeenCalled();
    expect(subject.jobs.complete).toHaveBeenCalledWith({ jobId: "job-1", leaseOwner: "worker-1" });
  });

  it("suppresses the chat notification when the model emits the silence token with surrounding whitespace", async () => {
    const subject = createSubject({
      shouldNotify: true,
      result: result({
        status: "completed",
        text: `  ${SCHEDULE_SILENCE_TOKEN}\n`,
        generatedFiles: []
      })
    });

    await subject.handler.process(job());

    expect(subject.outbounds.createAndComplete).not.toHaveBeenCalled();
  });

  it("suppresses the chat notification when the model produces no text", async () => {
    const subject = createSubject({
      shouldNotify: true,
      result: result({ status: "completed", text: undefined, generatedFiles: [] })
    });

    await subject.handler.process(job());

    expect(subject.outbounds.createAndComplete).not.toHaveBeenCalled();
  });

  it("still sends the reply when the silence token is embedded in a real update", async () => {
    const subject = createSubject({
      shouldNotify: true,
      result: result({
        status: "completed",
        text: `Heads up: saw ${SCHEDULE_SILENCE_TOKEN} in the logs.`,
        generatedFiles: []
      })
    });

    await subject.handler.process(job());

    expect(subject.outbounds.createAndComplete).toHaveBeenCalledWith(
      job(),
      expect.objectContaining({
        text: `**@brain**\n\nHeads up: saw ${SCHEDULE_SILENCE_TOKEN} in the logs.`
      })
    );
  });

  it("still ships generated images when the model emits the silence token", async () => {
    const subject = createSubject({
      shouldNotify: true,
      result: result({
        status: "completed",
        text: SCHEDULE_SILENCE_TOKEN,
        generatedFiles: [exampleAttachment]
      })
    });

    await subject.handler.process(job());

    expect(subject.outbounds.createAndComplete).toHaveBeenCalledWith(
      job(),
      expect.objectContaining({
        images: [exampleAttachment],
        threadAnchorText: "_scheduled_ — Daily review · @brain"
      })
    );
    const call = subject.outbounds.createAndComplete.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(call).not.toHaveProperty("text");
  });

  it("still surfaces failure and timeout states as notifications even with empty text", async () => {
    const subject = createSubject({
      shouldNotify: true,
      result: result({ status: "failed", text: undefined, generatedFiles: [] })
    });

    await subject.handler.process(job());

    expect(subject.outbounds.createAndComplete).toHaveBeenCalledWith(
      job(),
      expect.objectContaining({ text: "**@brain**\n\nPi run failed.", images: [] })
    );
  });
});

function createSubject(
  overrides: {
    schedule?: typeof exampleScheduledJob | undefined;
    execution?: ScheduledExecutionV1;
    shouldNotify?: boolean;
    result?: PiRunResultV1;
  } = {}
) {
  const queued = overrides.execution ?? execution();
  const running = { ...queued, status: "running" as const, attempt: queued.attempt + 1 };
  const completed = {
    ...running,
    status: "succeeded" as const,
    finishedAt: "2026-07-27T10:00:01.000Z"
  };
  const piResult = overrides.result ?? result();
  const schedules = {
    get: vi
      .fn()
      .mockResolvedValue("schedule" in overrides ? overrides.schedule : exampleScheduledJob)
  };
  const executions = { get: vi.fn().mockResolvedValue(queued) };
  const sessions = { resolve: vi.fn().mockResolvedValue(session()) };
  const lifecycle = {
    start: vi.fn().mockResolvedValue(running),
    finish: vi.fn().mockResolvedValue(completed),
    skip: vi.fn().mockResolvedValue({ ...queued, status: "skipped" as const })
  };
  const requests = { create: vi.fn().mockReturnValue({ id: "run-1" }) };
  const pi = { run: vi.fn().mockResolvedValue(piResult) };
  const notifications = {
    shouldNotify: vi.fn().mockResolvedValue(overrides.shouldNotify ?? false)
  };
  const outbounds = { createAndComplete: vi.fn().mockResolvedValue(undefined) };
  const jobs = { complete: vi.fn().mockResolvedValue(undefined) };

  return {
    handler: new ScheduleJobHandler({
      schedules,
      executions,
      sessions,
      lifecycle,
      requests,
      pi,
      notifications,
      outbounds,
      jobs,
      workerId: "worker-1"
    }),
    sessions,
    lifecycle,
    pi,
    notifications,
    outbounds,
    jobs,
    running,
    result: piResult
  };
}

function job(): InternalJobV1 {
  return {
    schemaVersion: 1,
    id: "job-1",
    type: "run_schedule",
    payload: { scheduleId: "schedule-1", executionId: "execution-1" },
    priority: 100,
    status: "leased",
    attempts: 0,
    availableAt: "2026-07-27T10:00:00.000Z",
    idempotencyKey: "job-1"
  };
}

function execution(overrides: Partial<ScheduledExecutionV1> = {}): ScheduledExecutionV1 {
  return {
    schemaVersion: 1,
    id: "execution-1",
    scheduleId: "schedule-1",
    scheduledFor: "2026-07-27T10:00:00.000Z",
    status: "queued",
    attempt: 0,
    createdAt: "2026-07-27T10:00:00.000Z",
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

function result(overrides: Partial<PiRunResultV1> = {}): PiRunResultV1 {
  return {
    schemaVersion: 1,
    id: "run-1",
    traceId: "trace-1",
    sessionId: "session-1",
    status: "completed",
    text: "Pi response",
    generatedFiles: [],
    startedAt: "2026-07-27T10:00:00.000Z",
    finishedAt: "2026-07-27T10:00:01.000Z",
    ...overrides
  };
}
