import type { ExecutionRepositoryPort } from "@second-brain/application/ports/scheduling";
import {
  ScheduledExecutionV1Schema,
  type ScheduledExecutionV1,
  type StructuredErrorV1
} from "@second-brain/contracts/schemas";

import type { PostgresQueryable } from "../postgres-queryable.js";
import { toIso } from "../postgres-schedule-row.js";
import { typedDatabase, type TypedPostgresDatabase } from "../typed-database.js";

export interface PostgresExecutionRepositoryOptions {
  db: PostgresQueryable;
}

export class PostgresExecutionRepository implements ExecutionRepositoryPort {
  private readonly db: TypedPostgresDatabase;
  private readonly rawDb: PostgresQueryable;

  constructor(options: PostgresExecutionRepositoryOptions) {
    this.db = typedDatabase(options.db);
    this.rawDb = options.db;
  }

  async create(execution: ScheduledExecutionV1) {
    const inserted = await this.rawDb.query<ExecutionRow>(
      `INSERT INTO brain_core.scheduled_executions (
        id, schema_version, schedule_id, scheduled_for, status, attempt, session_id,
        result_fingerprint, error, created_at, started_at, finished_at, workspace_id
      ) SELECT $1, $2, $3, $4::timestamptz, $5, $6, $7, $8, $9::jsonb,
        $10::timestamptz, $11::timestamptz, $12::timestamptz, workspace_id
      FROM brain_core.scheduled_jobs WHERE id = $3
      ON CONFLICT (schedule_id, scheduled_for) DO NOTHING RETURNING *`,
      executionValues(execution)
    );
    if (inserted.rows[0])
      return { execution: rowToExecution(inserted.rows[0]), duplicate: false as const };
    const existing = await this.getByScheduleOccurrence(
      execution.scheduleId,
      execution.scheduledFor
    );
    if (!existing) {
      throw new Error(
        `Execution duplicate index returned no row: ${execution.scheduleId} ${execution.scheduledFor}`
      );
    }
    return { execution: existing, duplicate: true as const };
  }

  async get(id: string): Promise<ScheduledExecutionV1 | undefined> {
    const row = await executionQuery(this.db).where("id", "=", id).executeTakeFirst();
    return row ? rowToExecution(row) : undefined;
  }

  async listBySchedule(scheduleId: string): Promise<ScheduledExecutionV1[]> {
    const rows = await executionQuery(this.db)
      .where("schedule_id", "=", scheduleId)
      .orderBy("scheduled_for", "desc")
      .orderBy("created_at", "desc")
      .orderBy("id", "asc")
      .execute();
    return rows.map(rowToExecution);
  }

  async findActiveBySchedule(scheduleId: string): Promise<ScheduledExecutionV1 | undefined> {
    const row = await executionQuery(this.db)
      .where("schedule_id", "=", scheduleId)
      .where("status", "in", ["created", "queued", "running"])
      .orderBy("scheduled_for", "asc")
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .executeTakeFirst();
    return row ? rowToExecution(row) : undefined;
  }

  async update(execution: ScheduledExecutionV1): Promise<ScheduledExecutionV1> {
    const row = await this.db
      .withSchema("brain_core")
      .updateTable("scheduled_executions")
      .set({
        status: execution.status,
        attempt: execution.attempt,
        session_id: execution.sessionId ?? null,
        result_fingerprint: execution.resultFingerprint ?? null,
        error: execution.error ?? null,
        started_at: execution.startedAt ?? null,
        finished_at: execution.finishedAt ?? null
      })
      .where("id", "=", execution.id)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new Error(`Unknown execution: ${execution.id}`);
    return rowToExecution(row);
  }

  private async getByScheduleOccurrence(scheduleId: string, scheduledFor: string) {
    const row = await executionQuery(this.db)
      .where("schedule_id", "=", scheduleId)
      .where("scheduled_for", "=", scheduledFor)
      .executeTakeFirst();
    return row ? rowToExecution(row) : undefined;
  }
}

interface ExecutionRow {
  id: string;
  schema_version: number;
  schedule_id: string;
  scheduled_for: Date | string;
  status: string;
  attempt: number | string;
  session_id: string | null;
  result_fingerprint: string | null;
  error: StructuredErrorV1 | null;
  created_at: Date | string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
}

function executionValues(execution: ScheduledExecutionV1): readonly unknown[] {
  return [
    execution.id,
    execution.schemaVersion,
    execution.scheduleId,
    execution.scheduledFor,
    execution.status,
    execution.attempt,
    execution.sessionId ?? null,
    execution.resultFingerprint ?? null,
    execution.error ? JSON.stringify(execution.error) : null,
    execution.createdAt,
    execution.startedAt ?? null,
    execution.finishedAt ?? null
  ];
}

function rowToExecution(row: ExecutionRow): ScheduledExecutionV1 {
  return ScheduledExecutionV1Schema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    scheduleId: row.schedule_id,
    scheduledFor: toIso(row.scheduled_for),
    status: row.status,
    attempt: Number(row.attempt),
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    ...(row.result_fingerprint ? { resultFingerprint: row.result_fingerprint } : {}),
    ...(row.error ? { error: row.error } : {}),
    createdAt: toIso(row.created_at),
    ...(row.started_at ? { startedAt: toIso(row.started_at) } : {}),
    ...(row.finished_at ? { finishedAt: toIso(row.finished_at) } : {})
  });
}

function executionQuery(db: TypedPostgresDatabase) {
  return db.withSchema("brain_core").selectFrom("scheduled_executions").selectAll();
}
