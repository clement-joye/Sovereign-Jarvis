import { describe, expect, it, vi } from "vitest";

import type { PiRunResultV1, ScheduledExecutionV1 } from "@second-brain/contracts";
import type { SessionRecord } from "@second-brain/domain";

import { ScheduledExecutionLifecycle } from "./scheduled-execution-lifecycle.js";
import type { ExecutionRepositoryPort } from "../../ports.js";

describe("ScheduledExecutionLifecycle", () => {
  it("marks an execution running with its resolved session and start time", async () => {
    const update = vi.fn<ExecutionRepositoryPort["update"]>(async (value) => value);
    const lifecycle = createLifecycle(update);

    await expect(lifecycle.start(execution(), session())).resolves.toMatchObject({
      status: "running",
      attempt: 2,
      sessionId: "session-1",
      startedAt: "2026-01-01T00:00:00.000Z"
    });
  });

  it("maps Pi results to final status, fingerprint, error, and finish time", async () => {
    const update = vi.fn<ExecutionRepositoryPort["update"]>(async (value) => value);
    const lifecycle = createLifecycle(update);
    const result: PiRunResultV1 = {
      schemaVersion: 1,
      id: "pi-run-1",
      traceId: "trace-1",
      sessionId: "session-1",
      status: "completed",
      text: "Result",
      generatedFiles: [],
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:01:00.000Z"
    };

    await expect(
      lifecycle.finish({ ...execution(), status: "running" }, result)
    ).resolves.toMatchObject({
      status: "succeeded",
      resultFingerprint: "91b2b43d",
      finishedAt: "2026-01-01T00:00:00.000Z"
    });
  });
});

function createLifecycle(update: ExecutionRepositoryPort["update"]): ScheduledExecutionLifecycle {
  return new ScheduledExecutionLifecycle({
    executions: { update },
    clock: { now: () => new Date("2026-01-01T00:00:00.000Z") }
  });
}

function execution(): ScheduledExecutionV1 {
  return {
    schemaVersion: 1,
    id: "execution-1",
    scheduleId: "schedule-1",
    scheduledFor: "2026-01-01T09:00:00.000Z",
    status: "queued",
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
