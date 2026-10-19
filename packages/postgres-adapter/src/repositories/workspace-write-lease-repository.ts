import type { WorkspaceWriteLeaseRepositoryPort } from "@second-brain/application/ports/workspace";
import {
  WorkspaceWriteLeaseV1Schema,
  type WorkspaceWriteLeaseV1
} from "@second-brain/contracts/schemas";

import type { PostgresQueryable } from "../postgres-queryable.js";
import { typedDatabase, type TypedPostgresDatabase } from "../typed-database.js";

interface WorkspaceWriteLeaseRow {
  id: string;
  workspace_id: string;
  owner_run_id: string;
  acquired_at: string | Date;
  expires_at: string | Date;
}

/** Uses conditional upserts so only one unexpired writer owns a workspace. */
export class PostgresWorkspaceWriteLeaseRepository implements WorkspaceWriteLeaseRepositoryPort {
  private readonly db: TypedPostgresDatabase;

  constructor(source: PostgresQueryable) {
    this.db = typedDatabase(source);
  }

  async acquire(
    input: WorkspaceWriteLeaseV1,
    now: Date
  ): Promise<WorkspaceWriteLeaseV1 | undefined> {
    const row = await this.db
      .withSchema("brain_core")
      .insertInto("workspace_write_leases")
      .values(leaseValues(input))
      .onConflict((conflict) =>
        conflict
          .column("workspace_id")
          .doUpdateSet((expression) => ({
            id: expression.ref("excluded.id"),
            owner_run_id: expression.ref("excluded.owner_run_id"),
            acquired_at: expression.ref("excluded.acquired_at"),
            expires_at: expression.ref("excluded.expires_at")
          }))
          .where((expression) =>
            expression.or([
              expression("workspace_write_leases.expires_at", "<=", now),
              expression(
                "workspace_write_leases.owner_run_id",
                "=",
                expression.ref("excluded.owner_run_id")
              )
            ])
          )
      )
      .returningAll()
      .executeTakeFirst();
    return row ? rowToLease(row) : undefined;
  }

  async renew(input: WorkspaceWriteLeaseV1, now: Date): Promise<WorkspaceWriteLeaseV1 | undefined> {
    const row = await this.db
      .withSchema("brain_core")
      .updateTable("workspace_write_leases")
      .set("expires_at", input.expiresAt)
      .where("workspace_id", "=", input.workspaceId)
      .where("owner_run_id", "=", input.ownerRunId)
      .where("expires_at", ">", now)
      .returningAll()
      .executeTakeFirst();
    return row ? rowToLease(row) : undefined;
  }

  async release(input: { workspaceId: string; ownerRunId: string }): Promise<boolean> {
    const result = await this.db
      .withSchema("brain_core")
      .deleteFrom("workspace_write_leases")
      .where("workspace_id", "=", input.workspaceId)
      .where("owner_run_id", "=", input.ownerRunId)
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  }

  async get(workspaceId: string): Promise<WorkspaceWriteLeaseV1 | undefined> {
    const row = await this.db
      .withSchema("brain_core")
      .selectFrom("workspace_write_leases")
      .selectAll()
      .where("workspace_id", "=", workspaceId)
      .executeTakeFirst();
    return row ? rowToLease(row) : undefined;
  }
}

function leaseValues(lease: WorkspaceWriteLeaseV1) {
  return {
    workspace_id: lease.workspaceId,
    id: lease.id,
    owner_run_id: lease.ownerRunId,
    acquired_at: lease.acquiredAt,
    expires_at: lease.expiresAt
  };
}

function rowToLease(row: WorkspaceWriteLeaseRow): WorkspaceWriteLeaseV1 {
  return WorkspaceWriteLeaseV1Schema.parse({
    schemaVersion: 1,
    id: row.id,
    workspaceId: row.workspace_id,
    ownerRunId: row.owner_run_id,
    acquiredAt: new Date(row.acquired_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString()
  });
}
