import { describe, expect, it } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";

import { PostgresWorkspaceWriteLeaseRepository } from "./workspace-write-lease-repository.js";
import type { PostgresQueryable } from "../job-queue.js";

const lease = {
  schemaVersion: 1 as const,
  id: "lease-1",
  workspaceId: "workspace-1",
  ownerRunId: "run-1",
  acquiredAt: "2026-08-18T20:00:00.000Z",
  expiresAt: "2026-08-18T20:01:00.000Z"
};

describe("PostgresWorkspaceWriteLeaseRepository", () => {
  it("acquires only when the existing lease is expired or owned by the same run", async () => {
    const db = new RecordingDb([[row()]]);
    const repository = new PostgresWorkspaceWriteLeaseRepository(db);
    await expect(repository.acquire(lease, new Date(lease.acquiredAt))).resolves.toMatchObject(
      lease
    );
    expect(db.calls[0]?.sql).toContain('on conflict ("workspace_id") do update');
    expect(db.calls[0]?.sql).toContain('"workspace_write_leases"."expires_at" <= $6');
    expect(db.calls[0]?.sql).toContain(
      '"workspace_write_leases"."owner_run_id" = "excluded"."owner_run_id"'
    );
  });

  it("renews and releases only the active owner", async () => {
    const db = new RecordingDb([[row()], []]);
    const repository = new PostgresWorkspaceWriteLeaseRepository(db);
    await expect(repository.renew(lease, new Date(lease.acquiredAt))).resolves.toMatchObject(lease);
    await expect(
      repository.release({ workspaceId: "workspace-1", ownerRunId: "run-2" })
    ).resolves.toBe(false);
    expect(db.calls[0]?.sql).toContain('"owner_run_id" = $3');
    expect(db.calls[1]?.sql).toContain('delete from "brain_core"."workspace_write_leases"');
  });
});

class RecordingDb implements PostgresQueryable {
  readonly calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
  private index = 0;
  constructor(private readonly rows: QueryResultRow[][]) {}
  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<T>> {
    this.calls.push(values ? { sql: text, values } : { sql: text });
    const rows = (this.rows[this.index++] ?? []) as T[];
    return {
      command: text.trimStart().split(" ", 1)[0]?.toUpperCase() ?? "SELECT",
      oid: 0,
      fields: [],
      rows,
      rowCount: rows.length
    };
  }
}

function row(): QueryResultRow {
  return {
    id: lease.id,
    workspace_id: lease.workspaceId,
    owner_run_id: lease.ownerRunId,
    acquired_at: lease.acquiredAt,
    expires_at: lease.expiresAt
  };
}
