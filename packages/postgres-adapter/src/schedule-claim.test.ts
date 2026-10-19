import { describe, expect, it } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";

import type { IdGeneratorPort } from "@second-brain/domain";

import { PostgresScheduleClaimService, type PostgresTransactionalClient } from "./index.js";

describe("PostgresScheduleClaimService", () => {
  it("commits due claim, execution creation, job enqueue, and schedule advancement together", async () => {
    const client = new RecordingClient([
      [],
      [scheduleRow()],
      [],
      [executionRow()],
      [jobRow()],
      [
        scheduleRow({
          next_run_at: "2026-07-17T16:05:00.000Z",
          last_run_at: "2026-07-17T16:00:00.000Z",
          version: 2,
          updated_at: "2026-07-17T16:00:00.000Z"
        })
      ],
      []
    ]);
    const service = new PostgresScheduleClaimService({
      db: { connect: async () => client },
      ids: new SequentialIdGenerator()
    });

    await expect(
      service.claimDue({ now: new Date("2026-07-17T16:00:00.000Z"), limit: 2 })
    ).resolves.toMatchObject([
      {
        id: "execution-schedule-1-2026-07-17T16:00:00.000Z",
        status: "queued"
      }
    ]);

    expect(client.commands()).toEqual(["BEGIN", "COMMIT"]);
    expect(client.sql()).toContain("FOR UPDATE SKIP LOCKED");
    expect(client.sql()).toContain("INSERT INTO brain_core.scheduled_executions");
    expect(client.sql()).toContain('insert into "brain_jobs"."jobs"');
    expect(client.sql()).toContain('update "brain_core"."scheduled_jobs"');
    expect(client.released).toBe(true);
  });

  it("records skipped executions without enqueueing run jobs when overlap policy skips", async () => {
    const client = new RecordingClient([
      [],
      [scheduleRow({ overlap_policy: "skip" })],
      [executionRow({ id: "active", status: "running" })],
      [executionRow({ status: "skipped" })],
      [
        scheduleRow({
          next_run_at: "2026-07-17T16:05:00.000Z",
          last_run_at: "2026-07-17T16:00:00.000Z",
          version: 2,
          updated_at: "2026-07-17T16:00:00.000Z"
        })
      ],
      []
    ]);
    const service = new PostgresScheduleClaimService({
      db: { connect: async () => client },
      ids: new SequentialIdGenerator()
    });

    await expect(
      service.claimDue({ now: new Date("2026-07-17T16:00:00.000Z"), limit: 1 })
    ).resolves.toMatchObject([{ status: "skipped" }]);

    expect(client.sql()).not.toContain("INSERT INTO brain_jobs.jobs");
    expect(client.commands()).toEqual(["BEGIN", "COMMIT"]);
  });

  it("skips missed occurrences without creating executions when configured", async () => {
    const client = new RecordingClient([
      [],
      [scheduleRow({ missed_run_policy: "skip", next_run_at: "2026-07-17T16:00:00.000Z" })],
      [
        scheduleRow({
          missed_run_policy: "skip",
          next_run_at: "2026-07-17T17:05:00.000Z",
          last_run_at: "2026-07-17T16:00:00.000Z",
          version: 2,
          updated_at: "2026-07-17T17:00:00.000Z"
        })
      ],
      []
    ]);
    const service = new PostgresScheduleClaimService({
      db: { connect: async () => client },
      ids: new SequentialIdGenerator()
    });

    await expect(
      service.claimDue({ now: new Date("2026-07-17T17:00:00.000Z"), limit: 1 })
    ).resolves.toEqual([]);

    expect(client.sql()).not.toContain("INSERT INTO brain_core.scheduled_executions");
    expect(client.sql()).not.toContain("INSERT INTO brain_jobs.jobs");
    expect(client.sql()).toContain('update "brain_core"."scheduled_jobs"');
    expect(client.commands()).toEqual(["BEGIN", "COMMIT"]);
  });

  it("queues one missed occurrence and advances directly to a future occurrence", async () => {
    const client = new RecordingClient([
      [],
      [scheduleRow({ missed_run_policy: "run_once", next_run_at: "2026-07-17T16:00:00.000Z" })],
      [],
      [executionRow({ scheduled_for: "2026-07-17T16:00:00.000Z" })],
      [jobRow()],
      [
        scheduleRow({
          missed_run_policy: "run_once",
          next_run_at: "2026-07-17T17:05:00.000Z",
          last_run_at: "2026-07-17T16:00:00.000Z",
          version: 2,
          updated_at: "2026-07-17T17:00:00.000Z"
        })
      ],
      []
    ]);
    const service = new PostgresScheduleClaimService({
      db: { connect: async () => client },
      ids: new SequentialIdGenerator()
    });

    await expect(
      service.claimDue({ now: new Date("2026-07-17T17:00:00.000Z"), limit: 1 })
    ).resolves.toMatchObject([{ scheduledFor: "2026-07-17T16:00:00.000Z", status: "queued" }]);

    expect(client.sql()).toContain("INSERT INTO brain_core.scheduled_executions");
    expect(client.sql()).toContain('insert into "brain_jobs"."jobs"');
  });

  it("rolls back when any claim step fails", async () => {
    const client = new RecordingClient([[], [scheduleRow()], [], [executionRow()], [jobRow()]]);
    client.failAt = 5;
    const service = new PostgresScheduleClaimService({
      db: { connect: async () => client },
      ids: new SequentialIdGenerator()
    });

    await expect(
      service.claimDue({ now: new Date("2026-07-17T16:00:00.000Z"), limit: 1 })
    ).rejects.toThrow(/forced query failure/);

    expect(client.commands()).toEqual(["BEGIN", "ROLLBACK"]);
    expect(client.released).toBe(true);
  });
});

class SequentialIdGenerator implements IdGeneratorPort {
  private next = 1;

  nextId(prefix: string): string {
    const id = `${prefix}-${this.next}`;
    this.next += 1;
    return id;
  }
}

class RecordingClient implements PostgresTransactionalClient {
  readonly calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
  released = false;
  failAt?: number;
  private resultIndex = 0;

  constructor(private readonly rows: QueryResultRow[][]) {}

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<T>> {
    this.calls.push(values ? { sql: text, values } : { sql: text });
    if (this.failAt !== undefined && this.calls.length === this.failAt) {
      throw new Error("forced query failure");
    }
    const rows = (this.rows[this.resultIndex] ?? []) as T[];
    this.resultIndex += 1;
    return {
      command: "SELECT",
      oid: 0,
      fields: [],
      rows,
      rowCount: rows.length
    };
  }

  release(): void {
    this.released = true;
  }

  commands(): string[] {
    return this.calls
      .map((call) => call.sql.trim())
      .filter((sql) => sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK");
  }

  sql(): string {
    return this.calls.map((call) => call.sql).join("\n");
  }
}

function scheduleRow(overrides: QueryResultRow = {}): QueryResultRow {
  return {
    id: "schedule-1",
    workspace_id: "workspace-example",
    destination_conversation_id: "!room:example",
    schema_version: 1,
    name: "Five minute check",
    instruction: "Ping.",
    schedule: {
      type: "interval",
      seconds: 300,
      timezone: "UTC"
    },
    enabled: true,
    session_policy: { type: "fresh" },
    notification_policy: "always",
    overlap_policy: "queue",
    missed_run_policy: "run_once",
    timeout_seconds: 600,
    next_run_at: "2026-07-17T16:00:00.000Z",
    last_run_at: null,
    version: 1,
    created_at: "2026-07-17T15:00:00.000Z",
    updated_at: "2026-07-17T15:00:00.000Z",
    ...overrides
  };
}

function executionRow(overrides: QueryResultRow = {}): QueryResultRow {
  return {
    id: "execution-schedule-1-2026-07-17T16:00:00.000Z",
    schema_version: 1,
    schedule_id: "schedule-1",
    scheduled_for: "2026-07-17T16:00:00.000Z",
    status: "queued",
    attempt: 0,
    session_id: null,
    result_fingerprint: null,
    error: null,
    created_at: "2026-07-17T16:00:00.000Z",
    started_at: null,
    finished_at: null,
    ...overrides
  };
}

function jobRow(overrides: QueryResultRow = {}): QueryResultRow {
  return {
    id: "job-1",
    schema_version: 1,
    type: "run_schedule",
    payload: {
      scheduleId: "schedule-1",
      executionId: "execution-schedule-1-2026-07-17T16:00:00.000Z"
    },
    priority: 60,
    status: "pending",
    attempts: 0,
    available_at: "2026-07-17T16:00:00.000Z",
    lease_owner: null,
    lease_expires_at: null,
    idempotency_key: "run_schedule:execution-schedule-1-2026-07-17T16:00:00.000Z",
    ...overrides
  };
}
