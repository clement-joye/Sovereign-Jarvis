import { describe, expect, it } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";

import type { ScheduledExecutionV1, ScheduledJobV1 } from "@second-brain/contracts/schemas";

import type { PostgresQueryable } from "../job-queue.js";
import { PostgresExecutionRepository, PostgresScheduleRepository } from "./schedule-repository.js";

describe("PostgresScheduleRepository", () => {
  it("creates schedules in the durable schedule table", async () => {
    const db = new RecordingDb([[scheduleRow()]]);
    const repository = new PostgresScheduleRepository({ db });

    await expect(repository.create(sampleSchedule())).resolves.toMatchObject({
      id: "schedule-1",
      nextRunAt: "2026-07-17T15:05:00.000Z"
    });

    expect(db.calls[0]?.sql).toContain('insert into "brain_core"."scheduled_jobs"');
    expect(db.calls[0]?.sql).toContain('"destination_thread_root_external_event_id"');
    expect(db.calls[0]?.values).toContain("$thread:example");
  });

  it("updates schedules with optimistic version checks", async () => {
    const db = new RecordingDb([[scheduleRow({ version: 2, name: "Updated" })]]);
    const repository = new PostgresScheduleRepository({ db });

    await expect(
      repository.update(sampleSchedule({ name: "Updated", version: 2 }), 1)
    ).resolves.toMatchObject({ name: "Updated", version: 2 });

    expect(db.calls[0]?.sql).toContain('"destination_thread_root_external_event_id"');
    expect(db.calls[0]?.sql).toContain('and "version" = $18');
    expect(db.calls[0]?.values?.at(-2)).toBe("schedule-1");
    expect(db.calls[0]?.values?.at(-1)).toBe(1);
  });

  it("reports version conflicts on stale schedule updates", async () => {
    const db = new RecordingDb([[]], [0]);
    const repository = new PostgresScheduleRepository({ db });

    await expect(repository.update(sampleSchedule({ version: 2 }), 1)).rejects.toThrow(
      /Schedule version conflict/
    );
  });

  it("soft deletes schedules and clears future run state", async () => {
    const db = new RecordingDb([
      [
        scheduleRow({
          enabled: false,
          next_run_at: null,
          version: 2,
          updated_at: "2026-07-17T15:01:00.000Z"
        })
      ]
    ]);
    const repository = new PostgresScheduleRepository({ db });

    await expect(
      repository.delete({
        id: "schedule-1",
        now: new Date("2026-07-17T15:01:00.000Z"),
        expectedVersion: 1
      })
    ).resolves.toMatchObject({ enabled: false, version: 2 });

    expect(db.calls[0]?.sql).toContain('"deleted_at" = $3');
    expect(db.calls[0]?.sql).toContain('"next_run_at" = $2');
  });

  it("disables all future schedules for an archived workspace", async () => {
    const db = new RecordingDb([[]], [2]);
    const repository = new PostgresScheduleRepository({ db });

    await expect(
      repository.disableByWorkspace({
        workspaceId: "workspace-1",
        now: new Date("2026-08-14T12:00:00.000Z")
      })
    ).resolves.toBe(2);

    expect(db.calls[0]?.sql).toContain('where "workspace_id" = $4');
    expect(db.calls[0]?.values).toEqual([
      false,
      null,
      new Date("2026-08-14T12:00:00.000Z"),
      "workspace-1",
      true
    ]);
  });

  it("claims due schedules with row locking", async () => {
    const db = new RecordingDb([[scheduleRow()]]);
    const repository = new PostgresScheduleRepository({ db });

    await expect(
      repository.claimDue({ now: new Date("2026-07-17T15:10:00.000Z"), limit: 5 })
    ).resolves.toMatchObject([{ id: "schedule-1" }]);

    expect(db.calls[0]?.sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(db.calls[0]?.sql).toContain("next_run_at <= $1::timestamptz");
    expect(db.calls[0]?.values).toEqual(["2026-07-17T15:10:00.000Z", 5]);
  });

  it("normalizes legacy one-time schedule timestamps without an offset on read", async () => {
    const db = new RecordingDb([
      [
        scheduleRow({
          schedule: { type: "once", runAt: "2026-08-01T09:00:00" },
          next_run_at: "2026-08-01T09:00:00.000Z"
        })
      ]
    ]);
    const repository = new PostgresScheduleRepository({ db });

    await expect(repository.list()).resolves.toMatchObject([
      { schedule: { type: "once", runAt: "2026-08-01T09:00:00.000Z" } }
    ]);
  });
});

describe("PostgresExecutionRepository", () => {
  it("creates scheduled executions idempotently by schedule occurrence", async () => {
    const db = new RecordingDb([[executionRow()]]);
    const repository = new PostgresExecutionRepository({ db });

    await expect(repository.create(sampleExecution())).resolves.toEqual({
      execution: sampleExecution(),
      duplicate: false
    });

    expect(db.calls[0]?.sql).toContain("ON CONFLICT (schedule_id, scheduled_for) DO NOTHING");
  });

  it("returns the existing execution when an occurrence already exists", async () => {
    const db = new RecordingDb([[], [executionRow({ id: "execution-existing" })]]);
    const repository = new PostgresExecutionRepository({ db });

    await expect(repository.create(sampleExecution())).resolves.toMatchObject({
      execution: { id: "execution-existing" },
      duplicate: true
    });

    expect(db.calls[1]?.sql).toContain('where "schedule_id" = $1');
    expect(db.calls[1]?.values).toEqual(["schedule-1", "2026-07-17T15:05:00.000Z"]);
  });

  it("finds active executions before scheduling overlapping work", async () => {
    const db = new RecordingDb([[executionRow({ status: "running" })]]);
    const repository = new PostgresExecutionRepository({ db });

    await expect(repository.findActiveBySchedule("schedule-1")).resolves.toMatchObject({
      id: "execution-1",
      status: "running"
    });

    expect(db.calls[0]?.sql).toContain('"status" in ($2, $3, $4)');
    expect(db.calls[0]?.values).toEqual(["schedule-1", "created", "queued", "running"]);
  });

  it("updates execution status and result metadata", async () => {
    const updated = sampleExecution({
      status: "succeeded",
      attempt: 1,
      sessionId: "session-1",
      resultFingerprint: "result-1",
      finishedAt: "2026-07-17T15:06:00.000Z"
    });
    const db = new RecordingDb([
      [
        executionRow({
          status: "succeeded",
          attempt: 1,
          session_id: "session-1",
          result_fingerprint: "result-1",
          finished_at: "2026-07-17T15:06:00.000Z"
        })
      ]
    ]);
    const repository = new PostgresExecutionRepository({ db });

    await expect(repository.update(updated)).resolves.toMatchObject({
      status: "succeeded",
      resultFingerprint: "result-1"
    });

    expect(db.calls[0]?.sql).toContain('update "brain_core"."scheduled_executions"');
    expect(db.calls[0]?.values?.slice(0, 4)).toEqual(["succeeded", 1, "session-1", "result-1"]);
  });
});

class RecordingDb implements PostgresQueryable {
  readonly calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
  private resultIndex = 0;

  constructor(
    private readonly rows: QueryResultRow[][],
    private readonly rowCounts: number[] = []
  ) {}

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<T>> {
    this.calls.push(values ? { sql: text, values } : { sql: text });
    const rows = (this.rows[this.resultIndex] ?? []) as T[];
    const rowCount = this.rowCounts[this.resultIndex] ?? rows.length;
    this.resultIndex += 1;
    return {
      command: text.trimStart().slice(0, 6).toUpperCase(),
      oid: 0,
      fields: [],
      rows,
      rowCount
    };
  }
}

function sampleSchedule(overrides: Partial<ScheduledJobV1> = {}): ScheduledJobV1 {
  return {
    schemaVersion: 1,
    id: "schedule-1",
    workspaceId: "workspace-example",
    destinationConversationId: "!room:example",
    destinationThreadRootExternalEventId: "$thread:example",
    agentId: "brain",
    name: "Daily check",
    instruction: "Summarize the room.",
    schedule: {
      type: "cron",
      expression: "*/5 * * * *",
      timezone: "Europe/Stockholm"
    },
    enabled: true,
    sessionPolicy: { type: "fresh" },
    notificationPolicy: "always",
    overlapPolicy: "skip",
    missedRunPolicy: "run_once",
    timeoutSeconds: 600,
    nextRunAt: "2026-07-17T15:05:00.000Z",
    version: 1,
    createdAt: "2026-07-17T15:00:00.000Z",
    updatedAt: "2026-07-17T15:00:00.000Z",
    ...overrides
  };
}

function sampleExecution(overrides: Partial<ScheduledExecutionV1> = {}): ScheduledExecutionV1 {
  return {
    schemaVersion: 1,
    id: "execution-1",
    scheduleId: "schedule-1",
    scheduledFor: "2026-07-17T15:05:00.000Z",
    status: "queued",
    attempt: 0,
    createdAt: "2026-07-17T15:00:00.000Z",
    ...overrides
  };
}

function scheduleRow(overrides: QueryResultRow = {}): QueryResultRow {
  return {
    id: "schedule-1",
    workspace_id: "workspace-example",
    destination_conversation_id: "!room:example",
    destination_thread_root_external_event_id: "$thread:example",
    agent_id: "brain",
    schema_version: 1,
    name: "Daily check",
    instruction: "Summarize the room.",
    schedule: {
      type: "cron",
      expression: "*/5 * * * *",
      timezone: "Europe/Stockholm"
    },
    enabled: true,
    session_policy: { type: "fresh" },
    notification_policy: "always",
    overlap_policy: "skip",
    missed_run_policy: "run_once",
    timeout_seconds: 600,
    next_run_at: "2026-07-17T15:05:00.000Z",
    last_run_at: null,
    version: 1,
    created_at: "2026-07-17T15:00:00.000Z",
    updated_at: "2026-07-17T15:00:00.000Z",
    ...overrides
  };
}

function executionRow(overrides: QueryResultRow = {}): QueryResultRow {
  return {
    id: "execution-1",
    schema_version: 1,
    schedule_id: "schedule-1",
    scheduled_for: "2026-07-17T15:05:00.000Z",
    status: "queued",
    attempt: 0,
    session_id: null,
    result_fingerprint: null,
    error: null,
    created_at: "2026-07-17T15:00:00.000Z",
    started_at: null,
    finished_at: null,
    ...overrides
  };
}
