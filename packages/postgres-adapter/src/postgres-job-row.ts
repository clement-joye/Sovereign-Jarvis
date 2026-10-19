import type { InternalJobV1 } from "@second-brain/contracts/schemas";
import { InternalJobV1Schema } from "@second-brain/contracts/schemas";
import type { QueryResult, QueryResultRow } from "pg";

export interface JobRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  schema_version: number;
  type: string;
  payload: unknown;
  priority: number;
  status: string;
  attempts: number;
  available_at: Date | string;
  lease_owner: string | null;
  lease_expires_at: Date | string | null;
  idempotency_key: string;
}

export function rowToJob(row: JobRow): InternalJobV1 {
  return InternalJobV1Schema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type,
    payload: row.payload,
    priority: row.priority,
    status: row.status,
    attempts: row.attempts,
    availableAt: toIso(row.available_at),
    ...(row.lease_owner ? { leaseOwner: row.lease_owner } : {}),
    ...(row.lease_expires_at ? { leaseExpiresAt: toIso(row.lease_expires_at) } : {}),
    idempotencyKey: row.idempotency_key
  });
}

export function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function requireOne<T extends QueryResultRow>(result: QueryResult<T>, operation: string): T {
  const row = result.rows[0];
  if (!row) throw new Error(`Postgres job queue failed to ${operation}.`);
  return row;
}

export function assertUpdated(result: QueryResult, message: string): void {
  if (result.rowCount !== 1) throw new Error(message);
}
