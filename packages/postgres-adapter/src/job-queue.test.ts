import { describe, expect, it } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";

import type { InternalJobV1 } from "@second-brain/contracts/schemas";

import { PostgresJobQueue, pingPostgresPool, type PostgresQueryable } from "./job-queue.js";

describe("PostgresJobQueue", () => {
  it("enqueues jobs idempotently by idempotency key", async () => {
    const db = new RecordingDb([[jobRow({ id: "job-1" })]]);
    const queue = new PostgresJobQueue({ db });

    await expect(queue.enqueue(sampleJob())).resolves.toMatchObject({
      id: "job-1",
      status: "pending",
      availableAt: "2026-07-17T15:00:00.000Z"
    });

    expect(db.calls[0]?.sql).toContain('on conflict ("workspace_id", "idempotency_key") do update');
    expect(db.calls[0]?.values?.slice(0, 4)).toEqual([
      "job-1",
      "workspace-example",
      1,
      "process_inbound"
    ]);
  });

  it("claims jobs with row locking and expired lease recovery", async () => {
    const db = new RecordingDb([
      [
        jobRow({
          id: "job-1",
          status: "leased",
          lease_owner: "worker-2",
          lease_expires_at: "2026-07-17T15:00:30.000Z"
        })
      ]
    ]);
    const queue = new PostgresJobQueue({ db });

    await expect(
      queue.claim({
        workerId: "worker-2",
        limit: 1,
        now: new Date("2026-07-17T15:00:00.000Z"),
        leaseMs: 30_000,
        jobTypes: ["run_agent"]
      })
    ).resolves.toMatchObject([{ id: "job-1", leaseOwner: "worker-2" }]);

    expect(db.calls[0]?.sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(db.calls[0]?.sql).toContain("status IN ('leased', 'running')");
    expect(db.calls[0]?.sql).toContain("type = ANY($5::text[])");
    expect(db.calls[0]?.values).toEqual([
      "2026-07-17T15:00:00.000Z",
      1,
      "worker-2",
      "2026-07-17T15:00:30.000Z",
      ["run_agent"]
    ]);
  });

  it("serializes capacity and admits roots in the claim statement", async () => {
    const db = new RecordingDb([[jobRow({ id: "job-root" })]]);
    const queue = new PostgresJobQueue({ db });
    await queue.claim({
      workerId: "worker-1",
      limit: 1,
      now: new Date("2026-07-17T15:00:00.000Z"),
      leaseMs: 90_000,
      rootAdmission: { limit: 1, leaseMs: 90_000 }
    });
    expect(db.calls[0]?.sql).toContain("pg_advisory_xact_lock");
    expect(db.calls[0]?.sql).toContain("INSERT INTO brain_core.root_run_admissions");
    expect(db.calls[0]?.sql).toContain("FOR UPDATE SKIP LOCKED");
  });

  it("renews the job and root lease together", async () => {
    const db = new RecordingDb([[{ "?column?": 1 }]]);
    const queue = new PostgresJobQueue({ db });
    await expect(
      queue.renew({
        jobId: "job-1",
        leaseOwner: "worker-1",
        now: new Date("2026-07-17T15:00:00.000Z"),
        leaseMs: 90_000,
        admissionLeaseMs: 90_000
      })
    ).resolves.toBe(true);
    expect(db.calls[0]?.sql).toContain("renewed_admission");
  });

  it("requires the active lease owner to complete a job", async () => {
    const db = new RecordingDb([], [0]);
    const queue = new PostgresJobQueue({ db });

    await expect(queue.complete({ jobId: "job-1", leaseOwner: "worker-2" })).rejects.toThrow(
      /active lease owner/
    );
  });

  it("marks retryable failures as retry_wait until max attempts", async () => {
    const db = new RecordingDb([
      [
        jobRow({
          status: "retry_wait",
          attempts: 1,
          available_at: "2026-07-17T15:00:11.000Z",
          lease_owner: null,
          lease_expires_at: null,
          payload: { lastError: "dependency down" }
        })
      ]
    ]);
    const queue = new PostgresJobQueue({ db });

    await expect(
      queue.fail({
        jobId: "job-1",
        leaseOwner: "worker-1",
        now: new Date("2026-07-17T15:00:01.000Z"),
        retryable: true,
        reason: "dependency down",
        retryDelayMs: 10_000,
        maxAttempts: 3
      })
    ).resolves.toMatchObject({
      id: "job-1",
      status: "retry_wait",
      attempts: 1,
      availableAt: "2026-07-17T15:00:11.000Z"
    });

    expect(db.calls[0]?.sql).toContain("jsonb_build_object('lastError'");
  });

  it("lists jobs for admin inspection", async () => {
    const db = new RecordingDb([[jobRow({ id: "job-1" }), jobRow({ id: "job-2" })]]);
    const queue = new PostgresJobQueue({ db });

    await expect(queue.snapshot()).resolves.toMatchObject([{ id: "job-1" }, { id: "job-2" }]);
    expect(db.calls[0]?.sql).toContain('from "brain_jobs"."jobs"');
    expect(db.calls[0]?.sql).toContain('order by "created_at" asc');
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
      command: "SELECT",
      oid: 0,
      fields: [],
      rows,
      rowCount
    };
  }
}

function sampleJob(overrides: Partial<InternalJobV1> = {}): InternalJobV1 {
  return {
    schemaVersion: 1,
    id: "job-1",
    workspaceId: "workspace-example",
    type: "process_inbound",
    payload: { inboundMessageId: "inbound-1" },
    priority: 100,
    status: "pending",
    attempts: 0,
    availableAt: "2026-07-17T15:00:00.000Z",
    idempotencyKey: "same",
    ...overrides
  };
}

function jobRow(overrides: QueryResultRow = {}): QueryResultRow {
  return {
    id: "job-1",
    workspace_id: "workspace-example",
    schema_version: 1,
    type: "process_inbound",
    payload: { inboundMessageId: "inbound-1" },
    priority: 100,
    status: "pending",
    attempts: 0,
    available_at: "2026-07-17T15:00:00.000Z",
    lease_owner: null,
    lease_expires_at: null,
    idempotency_key: "same",
    ...overrides
  };
}

describe("pingPostgresPool", () => {
  it("returns true when the SELECT 1 round-trip succeeds", async () => {
    const queries: string[] = [];
    const db: PostgresQueryable = {
      async query(text) {
        queries.push(text);
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] } as QueryResult;
      }
    };
    expect(await pingPostgresPool(db, 1_000)).toBe(true);
    expect(queries).toEqual(["SELECT 1"]);
  });

  it("returns false when the query throws", async () => {
    const db: PostgresQueryable = {
      async query() {
        throw new Error("connection refused");
      }
    };
    expect(await pingPostgresPool(db, 1_000)).toBe(false);
  });

  it("returns false when the query does not resolve within the timeout", async () => {
    const db: PostgresQueryable = {
      async query() {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] } as QueryResult;
      }
    };
    expect(await pingPostgresPool(db, 10)).toBe(false);
  });
});
