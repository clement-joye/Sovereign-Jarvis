import type { JobQueuePort, RootRunAdmissionSnapshot } from "@second-brain/application/ports/jobs";
import type { InternalJobV1 } from "@second-brain/contracts/schemas";
import { requireWorkspaceId } from "@second-brain/domain";
import type { PostgresQueryable } from "./postgres-queryable.js";
import { rowToJob, type JobRow } from "./postgres-job-row.js";
import {
  cancelRootRunJobs,
  completeJob,
  failJob,
  renewJobLease
} from "./postgres-job-lease-lifecycle.js";
import { snapshotRootAdmission } from "./postgres-root-admission-snapshot.js";
import { cancelLatestInboundTurn } from "./postgres-active-inbound-run.js";
import { typedDatabase, type TypedPostgresDatabase } from "./typed-database.js";

export type { PostgresQueryable } from "./postgres-queryable.js";
export { createPostgresPool, pingPostgresPool } from "./postgres-pool.js";
export type { PostgresPoolConfig } from "./postgres-pool.js";

export interface PostgresJobQueueOptions {
  db: PostgresQueryable;
}

export class PostgresJobQueue implements JobQueuePort {
  private readonly rawDb: PostgresQueryable;
  private readonly db: TypedPostgresDatabase;

  constructor(options: PostgresJobQueueOptions) {
    this.rawDb = options.db;
    this.db = typedDatabase(options.db);
  }

  async enqueue(job: InternalJobV1): Promise<InternalJobV1> {
    const row = await this.db
      .withSchema("brain_jobs")
      .insertInto("jobs")
      .values({
        id: job.id,
        workspace_id: requireWorkspaceId(job.workspaceId, "Job enqueue"),
        schema_version: job.schemaVersion,
        type: job.type,
        payload: job.payload,
        priority: job.priority,
        status: job.status,
        attempts: job.attempts,
        available_at: job.availableAt,
        lease_owner: job.leaseOwner ?? null,
        lease_expires_at: job.leaseExpiresAt ?? null,
        idempotency_key: job.idempotencyKey
      })
      .onConflict((conflict) =>
        conflict.columns(["workspace_id", "idempotency_key"]).doUpdateSet((expression) => ({
          idempotency_key: expression.ref("excluded.idempotency_key")
        }))
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return rowToJob(row);
  }

  async cancelLatestInboundTurn(input: {
    workspaceId: string;
    conversationId: string;
    threadRootExternalEventId?: string;
    excludeInboundMessageId: string;
  }): Promise<{ runId: string; needsPiCancel: boolean } | undefined> {
    return cancelLatestInboundTurn(this.rawDb, input);
  }

  async claim(input: {
    workerId: string;
    limit: number;
    now: Date;
    leaseMs: number;
    jobTypes?: InternalJobV1["type"][];
    rootAdmission?: { limit: number; leaseMs: number };
  }): Promise<InternalJobV1[]> {
    if (input.rootAdmission) {
      return this.claimWithRootAdmission({ ...input, rootAdmission: input.rootAdmission });
    }
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs).toISOString();
    const result = await this.rawDb.query<JobRow>(
      `
        WITH claimable AS (
          SELECT id
          FROM brain_jobs.jobs
          WHERE
            ($5::text[] IS NULL OR type = ANY($5::text[]))
            AND (
              (
                status IN ('pending', 'retry_wait')
                AND available_at <= $1::timestamptz
              )
              OR (
                status IN ('leased', 'running')
                AND lease_expires_at IS NOT NULL
                AND lease_expires_at <= $1::timestamptz
              )
            )
          ORDER BY priority DESC, available_at ASC, id ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED
        )
        UPDATE brain_jobs.jobs AS jobs
        SET
          status = 'leased',
          lease_owner = $3,
          lease_expires_at = $4::timestamptz,
          updated_at = $1::timestamptz
        FROM claimable
        WHERE jobs.id = claimable.id
        RETURNING jobs.*
      `,
      [input.now.toISOString(), input.limit, input.workerId, leaseExpiresAt, input.jobTypes ?? null]
    );
    return result.rows.map(rowToJob);
  }

  private async claimWithRootAdmission(input: {
    workerId: string;
    limit: number;
    now: Date;
    leaseMs: number;
    jobTypes?: InternalJobV1["type"][];
    rootAdmission: { limit: number; leaseMs: number };
  }): Promise<InternalJobV1[]> {
    const now = input.now.toISOString();
    const jobExpiresAt = new Date(input.now.getTime() + input.leaseMs).toISOString();
    const admissionExpiresAt = new Date(
      input.now.getTime() + input.rootAdmission.leaseMs
    ).toISOString();
    const result = await this.rawDb.query<JobRow>(
      `
        WITH admission_lock AS MATERIALIZED (
          SELECT pg_advisory_xact_lock(7700139421001)
        ), capacity AS MATERIALIZED (
          SELECT GREATEST(
            $6::integer - COUNT(*) FILTER (
              WHERE state = 'active' AND expires_at > $1::timestamptz
            ),
            0
          )::integer AS slots
          FROM brain_core.root_run_admissions, admission_lock
        ), new_root_candidates AS MATERIALIZED (
          SELECT jobs.id
          FROM brain_jobs.jobs AS jobs, capacity
          WHERE jobs.type IN ('process_inbound', 'run_schedule')
            AND (jobs.type <> 'process_inbound' OR jobs.payload->>'requiresRootAdmission' IS DISTINCT FROM 'false')
            AND ($5::text[] IS NULL OR jobs.type = ANY($5::text[]))
            AND (
              (jobs.status IN ('pending', 'retry_wait') AND jobs.available_at <= $1::timestamptz)
              OR (jobs.status IN ('leased', 'running') AND jobs.lease_expires_at <= $1::timestamptz)
            )
            AND NOT EXISTS (
              SELECT 1 FROM brain_core.root_run_admissions admissions
              WHERE admissions.root_run_id = jobs.id
                AND admissions.state = 'active'
                AND admissions.expires_at > $1::timestamptz
            )
          ORDER BY jobs.priority DESC, jobs.available_at ASC, jobs.id ASC
          LIMIT (SELECT slots FROM capacity)
        ), claimable AS (
          SELECT jobs.id
          FROM brain_jobs.jobs AS jobs
          WHERE ($5::text[] IS NULL OR jobs.type = ANY($5::text[]))
            AND (
              (jobs.status IN ('pending', 'retry_wait') AND jobs.available_at <= $1::timestamptz)
              OR (jobs.status IN ('leased', 'running') AND jobs.lease_expires_at <= $1::timestamptz)
            )
            AND (
              jobs.type NOT IN ('process_inbound', 'run_schedule', 'run_agent')
              OR (jobs.type = 'process_inbound' AND jobs.payload->>'requiresRootAdmission' = 'false')
              OR jobs.id IN (SELECT id FROM new_root_candidates)
              OR EXISTS (
                SELECT 1 FROM brain_core.root_run_admissions admissions
                WHERE admissions.root_run_id = jobs.id
                  AND admissions.state = 'active'
                  AND admissions.expires_at > $1::timestamptz
              )
              OR (
                jobs.type = 'run_agent' AND EXISTS (
                  SELECT 1
                  FROM brain_core.agent_runs runs
                  JOIN brain_core.root_run_admissions admissions
                    ON admissions.root_run_id = runs.root_run_id
                  WHERE runs.id = jobs.payload->>'runId'
                    AND admissions.state = 'active'
                    AND admissions.expires_at > $1::timestamptz
                )
              )
            )
          ORDER BY jobs.priority DESC, jobs.available_at ASC, jobs.id ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED
        ), claimed AS (
          UPDATE brain_jobs.jobs AS jobs
          SET status = 'leased', lease_owner = $3, lease_expires_at = $4::timestamptz,
              updated_at = $1::timestamptz
          FROM claimable
          WHERE jobs.id = claimable.id
          RETURNING jobs.*
        ), expired AS (
          UPDATE brain_core.root_run_admissions admissions
          SET state = 'released', terminal_reason = 'lease_expired', released_at = $1::timestamptz
          WHERE admissions.state IN ('active', 'releasing')
            AND admissions.expires_at <= $1::timestamptz
            AND admissions.root_run_id NOT IN (
              SELECT id FROM claimed
              WHERE type IN ('process_inbound', 'run_schedule')
            )
          RETURNING root_run_id
        ), admitted AS (
          INSERT INTO brain_core.root_run_admissions (
            root_run_id, root_job_id, workspace_id, lease_owner,
            acquired_at, heartbeat_at, expires_at, state
          )
          SELECT id, id, workspace_id, $3, $1::timestamptz, $1::timestamptz,
                 $7::timestamptz, 'active'
          FROM claimed
          WHERE type IN ('process_inbound', 'run_schedule')
            AND (type <> 'process_inbound' OR payload->>'requiresRootAdmission' IS DISTINCT FROM 'false')
          ON CONFLICT (root_run_id) DO UPDATE SET
            lease_owner = EXCLUDED.lease_owner,
            acquired_at = EXCLUDED.acquired_at,
            heartbeat_at = EXCLUDED.heartbeat_at,
            expires_at = EXCLUDED.expires_at,
            state = 'active',
            terminal_reason = NULL,
            released_at = NULL
          RETURNING root_run_id
        )
        SELECT claimed.* FROM claimed
        WHERE (SELECT COUNT(*) FROM admitted) >= 0
          AND (SELECT COUNT(*) FROM expired) >= 0
      `,
      [
        now,
        input.limit,
        input.workerId,
        jobExpiresAt,
        input.jobTypes ?? null,
        input.rootAdmission.limit,
        admissionExpiresAt
      ]
    );
    return result.rows.map(rowToJob);
  }

  async renew(input: {
    jobId: string;
    leaseOwner: string;
    now: Date;
    leaseMs: number;
    admissionLeaseMs?: number;
  }): Promise<boolean> {
    return renewJobLease(this.rawDb, input);
  }

  async cancelRootRun(input: { rootRunId: string; now: Date; reason: string }): Promise<number> {
    return cancelRootRunJobs(this.rawDb, input);
  }

  async hasLiveRootAdmission(rootRunId: string, now: Date): Promise<boolean> {
    const row = await this.db
      .withSchema("brain_core")
      .selectFrom("root_run_admissions")
      .select("root_run_id")
      .where("root_run_id", "=", rootRunId)
      .where("state", "=", "active")
      .where("expires_at", ">", now)
      .executeTakeFirst();
    return row !== undefined;
  }

  async complete(input: { jobId: string; leaseOwner: string }): Promise<void> {
    await completeJob(this.rawDb, input);
  }

  async fail(input: {
    jobId: string;
    leaseOwner: string;
    now: Date;
    retryable: boolean;
    reason: string;
    retryDelayMs?: number;
    maxAttempts: number;
  }): Promise<InternalJobV1> {
    return failJob(this.rawDb, input);
  }

  async snapshot(): Promise<InternalJobV1[]> {
    const rows = await this.db
      .withSchema("brain_jobs")
      .selectFrom("jobs")
      .selectAll()
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();
    return rows.map(rowToJob);
  }

  async admissionSnapshot(limit: number, now = new Date()): Promise<RootRunAdmissionSnapshot> {
    return snapshotRootAdmission(this.rawDb, limit, now);
  }
}
