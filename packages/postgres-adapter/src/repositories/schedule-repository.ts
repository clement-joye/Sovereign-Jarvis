import type { ScheduleRepositoryPort } from "@second-brain/application/ports/scheduling";
import type { ScheduledJobV1 } from "@second-brain/contracts/schemas";
import { requireWorkspaceId } from "@second-brain/domain";
import { sql } from "kysely";

import type { PostgresQueryable } from "../postgres-queryable.js";
import { rowToSchedule, scheduleValues, type ScheduleRow } from "../postgres-schedule-row.js";
import { typedDatabase, type TypedPostgresDatabase } from "../typed-database.js";

export {
  PostgresExecutionRepository,
  type PostgresExecutionRepositoryOptions
} from "./postgres-execution-repository.js";

export interface PostgresScheduleRepositoryOptions {
  db: PostgresQueryable;
}

export class PostgresScheduleRepository implements ScheduleRepositoryPort {
  private readonly db: TypedPostgresDatabase;
  private readonly rawDb: PostgresQueryable;

  constructor(options: PostgresScheduleRepositoryOptions) {
    this.db = typedDatabase(options.db);
    this.rawDb = options.db;
  }

  async create(job: ScheduledJobV1): Promise<ScheduledJobV1> {
    const row = await this.db
      .withSchema("brain_core")
      .insertInto("scheduled_jobs")
      .values(scheduleValues(job))
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new Error(`Failed to create schedule: ${job.id}`);
    return rowToSchedule(row);
  }

  async get(id: string): Promise<ScheduledJobV1 | undefined> {
    const row = await scheduleQuery(this.db).where("id", "=", id).executeTakeFirst();
    return row ? rowToSchedule(row) : undefined;
  }

  async list(): Promise<ScheduledJobV1[]> {
    const rows = await scheduleQuery(this.db)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();
    return rows.map(rowToSchedule);
  }

  async hardDeleteDisabledOlderThan(input: {
    cutoff: Date;
    workspaceId?: string;
  }): Promise<number> {
    const result = await this.db
      .withSchema("brain_core")
      .deleteFrom("scheduled_jobs")
      .where("enabled", "=", false)
      .where("deleted_at", "is", null)
      .where("updated_at", "<", input.cutoff)
      .where("workspace_id", "=", requireWorkspaceId(input.workspaceId, "Schedule cleanup"))
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  async update(job: ScheduledJobV1, expectedVersion: number): Promise<ScheduledJobV1> {
    const row = await this.db
      .withSchema("brain_core")
      .updateTable("scheduled_jobs")
      .set({
        name: job.name,
        instruction: job.instruction,
        agent_id: job.agentId,
        destination_conversation_id: job.destinationConversationId ?? null,
        destination_thread_root_external_event_id: job.destinationThreadRootExternalEventId ?? null,
        schedule: job.schedule,
        enabled: job.enabled,
        session_policy: job.sessionPolicy,
        notification_policy: job.notificationPolicy,
        overlap_policy: job.overlapPolicy,
        missed_run_policy: job.missedRunPolicy,
        timeout_seconds: job.timeoutSeconds,
        next_run_at: job.nextRunAt ?? null,
        last_run_at: job.lastRunAt ?? null,
        version: job.version,
        updated_at: job.updatedAt
      })
      .where("id", "=", job.id)
      .where("version", "=", expectedVersion)
      .where("deleted_at", "is", null)
      .returningAll()
      .executeTakeFirst();
    if (!row) {
      throw new Error(`Schedule version conflict: ${job.id}`);
    }
    return rowToSchedule(row);
  }

  async delete(input: {
    id: string;
    now: Date;
    expectedVersion?: number;
  }): Promise<ScheduledJobV1> {
    let query = this.db
      .withSchema("brain_core")
      .updateTable("scheduled_jobs")
      .set({
        enabled: false,
        next_run_at: null,
        deleted_at: input.now,
        updated_at: input.now,
        version: sql<number>`version + 1`
      })
      .where("id", "=", input.id)
      .where("deleted_at", "is", null);
    if (input.expectedVersion !== undefined) {
      query = query.where("version", "=", input.expectedVersion);
    }
    const row = await query.returningAll().executeTakeFirst();
    if (!row) {
      throw new Error(`Schedule version conflict: ${input.id}`);
    }
    return rowToSchedule(row);
  }

  async disableByWorkspace(input: { workspaceId: string; now: Date }): Promise<number> {
    const result = await this.db
      .withSchema("brain_core")
      .updateTable("scheduled_jobs")
      .set({
        enabled: false,
        next_run_at: null,
        updated_at: input.now,
        version: sql<number>`version + 1`
      })
      .where("workspace_id", "=", input.workspaceId)
      .where("enabled", "=", true)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  async claimDue(input: { now: Date; limit: number }): Promise<ScheduledJobV1[]> {
    const result = await this.rawDb.query<ScheduleRow>(
      `
        SELECT *
        FROM brain_core.scheduled_jobs
        WHERE enabled = true
          AND deleted_at IS NULL
          AND next_run_at IS NOT NULL
          AND next_run_at <= $1::timestamptz
        ORDER BY next_run_at ASC, id ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      `,
      [input.now.toISOString(), input.limit]
    );
    return result.rows.map(rowToSchedule);
  }
}

function scheduleQuery(db: TypedPostgresDatabase) {
  return db
    .withSchema("brain_core")
    .selectFrom("scheduled_jobs")
    .selectAll()
    .where("deleted_at", "is", null);
}
