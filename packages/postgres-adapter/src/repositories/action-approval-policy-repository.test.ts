import { describe, expect, it } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";

import { PostgresActionApprovalPolicyRepository } from "./action-approval-policy-repository.js";
import type { PostgresTransactionSource, PostgresTransactionalClient } from "../transaction.js";

describe("PostgresActionApprovalPolicyRepository", () => {
  it("reads owner mode only for an explicitly persisted policy row", async () => {
    const db = new RecordingDb([[{ mode: "owner" }]]);
    const repository = new PostgresActionApprovalPolicyRepository(db);

    await expect(repository.getMode("workspace-1", "plugin.git", "push")).resolves.toBe("owner");
    expect(db.calls[0]?.sql).toContain(
      '"workspace_id" = $1 and "plugin_id" = $2 and "operation_id" = $3'
    );
    expect(db.calls[0]?.values).toEqual(["workspace-1", "plugin.git", "push"]);
  });

  it("replaces one workspace/plugin scope in a single transaction", async () => {
    const db = new RecordingDb();
    const repository = new PostgresActionApprovalPolicyRepository(db);
    const updatedAt = new Date("2026-08-29T12:00:00.000Z");

    await repository.replaceOwnerRequiredOperations({
      workspaceId: "workspace-1",
      pluginId: "plugin.git",
      operationIds: ["push", "push", "pull"],
      updatedAt
    });

    expect(db.calls.map(({ sql }) => sql.trim().split(/\s+/).slice(0, 2).join(" "))).toEqual([
      ["BEGIN"].join(" "),
      "delete from",
      "insert into",
      ["COMMIT"].join(" ")
    ]);
    expect(db.calls[1]?.values).toEqual(["workspace-1", "plugin.git"]);
    expect(db.calls[2]?.values).toEqual([
      "workspace-1",
      "plugin.git",
      "push",
      "owner",
      updatedAt,
      "workspace-1",
      "plugin.git",
      "pull",
      "owner",
      updatedAt
    ]);
    expect(db.released).toBe(true);
  });

  it("commits an empty replacement after deleting the prior scope", async () => {
    const db = new RecordingDb();
    const repository = new PostgresActionApprovalPolicyRepository(db);

    await repository.replaceOwnerRequiredOperations({
      workspaceId: "workspace-1",
      pluginId: "plugin.git",
      operationIds: [],
      updatedAt: new Date("2026-08-29T12:00:00.000Z")
    });

    expect(db.calls.map(({ sql }) => sql.trim())).toEqual([
      "BEGIN",
      expect.stringContaining('delete from "brain_core"."action_approval_policies"'),
      "COMMIT"
    ]);
  });

  it("rolls back if inserting the replacement fails", async () => {
    const db = new RecordingDb([], new Error("insert failed"));
    const repository = new PostgresActionApprovalPolicyRepository(db);

    await expect(
      repository.replaceOwnerRequiredOperations({
        workspaceId: "workspace-1",
        pluginId: "plugin.git",
        operationIds: ["push"],
        updatedAt: new Date("2026-08-29T12:00:00.000Z")
      })
    ).rejects.toThrow("insert failed");
    expect(db.calls.at(-1)?.sql).toBe("ROLLBACK");
    expect(db.released).toBe(true);
  });
});

class RecordingDb implements PostgresTransactionSource, PostgresTransactionalClient {
  readonly calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
  released = false;
  private readonly error: Error | undefined;

  constructor(
    private readonly rows: QueryResultRow[][] = [],
    error?: Error
  ) {
    this.error = error;
  }

  async connect(): Promise<PostgresTransactionalClient> {
    return this;
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<T>> {
    this.calls.push(values ? { sql: text, values } : { sql: text });
    if (this.error && text.toLowerCase().includes("insert into")) throw this.error;
    const nextRows = this.rows.shift() ?? [];
    return {
      command: "SELECT",
      oid: 0,
      fields: [],
      rows: nextRows as T[],
      rowCount: nextRows.length
    };
  }

  release(): void {
    this.released = true;
  }
}
