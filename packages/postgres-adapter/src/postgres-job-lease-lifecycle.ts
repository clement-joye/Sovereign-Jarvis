import type { PostgresQueryable } from "./postgres-queryable.js";
import type { InternalJobV1 } from "@second-brain/contracts/schemas";

import { requireOne, rowToJob, type JobRow } from "./postgres-job-row.js";

export async function renewJobLease(
  db: PostgresQueryable,
  input: {
    jobId: string;
    leaseOwner: string;
    now: Date;
    leaseMs: number;
    admissionLeaseMs?: number;
  }
): Promise<boolean> {
  const jobExpiresAt = new Date(input.now.getTime() + input.leaseMs).toISOString();
  const admissionExpiresAt = input.admissionLeaseMs
    ? new Date(input.now.getTime() + input.admissionLeaseMs).toISOString()
    : null;
  const result = await db.query(
    `
      WITH job_identity AS MATERIALIZED (
        SELECT jobs.*,
          CASE
            WHEN jobs.type = 'run_agent' THEN runs.root_run_id
            WHEN jobs.type IN ('process_inbound', 'run_schedule') THEN jobs.id
            ELSE NULL
          END AS root_run_id,
          CASE
            WHEN jobs.type = 'run_schedule' THEN true
            WHEN jobs.type = 'process_inbound' THEN jobs.payload->>'requiresRootAdmission' IS DISTINCT FROM 'false'
            WHEN jobs.type = 'run_agent' THEN true
            ELSE false
          END AS admission_required
        FROM brain_jobs.jobs jobs
        LEFT JOIN brain_core.agent_runs runs
          ON jobs.type = 'run_agent' AND runs.id = jobs.payload->>'runId'
        WHERE jobs.id = $1 AND jobs.lease_owner = $2
          AND jobs.status IN ('leased', 'running')
          AND jobs.lease_expires_at > $3::timestamptz
      ), renewed_job AS (
        UPDATE brain_jobs.jobs jobs
        SET lease_expires_at = $4::timestamptz, updated_at = $3::timestamptz
        FROM job_identity identity
        WHERE jobs.id = identity.id
          AND (
            NOT identity.admission_required
            OR EXISTS (
              SELECT 1 FROM brain_core.root_run_admissions admissions
              WHERE admissions.root_run_id = identity.root_run_id
                AND admissions.state = 'active'
                AND admissions.expires_at > $3::timestamptz
            )
          )
        RETURNING identity.root_run_id, identity.admission_required
      ), renewed_admission AS (
        UPDATE brain_core.root_run_admissions admissions
        SET heartbeat_at = $3::timestamptz, expires_at = $5::timestamptz
        FROM renewed_job job
        WHERE job.admission_required
          AND admissions.root_run_id = job.root_run_id
          AND admissions.state = 'active'
          AND $5::timestamptz IS NOT NULL
        RETURNING admissions.root_run_id
      )
      SELECT 1 FROM renewed_job WHERE (SELECT COUNT(*) FROM renewed_admission) >= 0
    `,
    [input.jobId, input.leaseOwner, input.now.toISOString(), jobExpiresAt, admissionExpiresAt]
  );
  return result.rowCount === 1;
}

export async function cancelRootRunJobs(
  db: PostgresQueryable,
  input: { rootRunId: string; now: Date; reason: string }
): Promise<number> {
  const result = await db.query<{ cancelled_count: number }>(
    `
      WITH root_state AS MATERIALIZED (
        SELECT status FROM brain_jobs.jobs WHERE id = $1
      ), cancelled AS (
        UPDATE brain_jobs.jobs jobs
        SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL,
            payload = payload || jsonb_build_object('cancellationReason', $3::text),
            updated_at = $2::timestamptz
        WHERE (
            jobs.id = $1
            OR (
              jobs.type = 'run_agent' AND EXISTS (
                SELECT 1 FROM brain_core.agent_runs runs
                WHERE runs.id = jobs.payload->>'runId' AND runs.root_run_id = $1
              )
            )
          )
          AND jobs.status IN ('pending', 'retry_wait', 'leased', 'running')
          AND (
            $3 = 'agent_tree_cancelled'
            OR (SELECT status FROM root_state) IN ('pending', 'retry_wait')
          )
        RETURNING id
      ), released AS (
        UPDATE brain_core.root_run_admissions
        SET state = 'released', terminal_reason = $3, released_at = $2::timestamptz
        WHERE root_run_id = $1 AND state IN ('active', 'releasing')
          AND (
            $3 = 'agent_tree_cancelled'
            OR (SELECT status FROM root_state) IN ('pending', 'retry_wait')
          )
        RETURNING root_run_id
      )
      SELECT COUNT(*)::integer AS cancelled_count FROM cancelled
      WHERE (SELECT COUNT(*) FROM released) >= 0
    `,
    [input.rootRunId, input.now.toISOString(), input.reason]
  );
  return result.rows[0]?.cancelled_count ?? 0;
}

export async function completeJob(
  db: PostgresQueryable,
  input: { jobId: string; leaseOwner: string }
): Promise<void> {
  const result = await db.query(
    `
      WITH completed AS (
        UPDATE brain_jobs.jobs
        SET status = 'completed', updated_at = now()
        WHERE id = $1 AND lease_owner = $2 AND status IN ('leased', 'running')
        RETURNING id, type, payload
      ), affected_root AS (
        SELECT CASE
          WHEN completed.type = 'run_agent' THEN runs.root_run_id
          WHEN completed.type IN ('process_inbound', 'run_schedule') THEN completed.id
          ELSE NULL
        END AS root_run_id
        FROM completed
        LEFT JOIN brain_core.agent_runs runs
          ON completed.type = 'run_agent' AND runs.id = completed.payload->>'runId'
      ), released AS (
        UPDATE brain_core.root_run_admissions admissions
        SET state = 'released', terminal_reason = 'completed', released_at = now()
        WHERE admissions.root_run_id IN (
            SELECT root_run_id FROM affected_root WHERE root_run_id IS NOT NULL
          )
          AND EXISTS (
            SELECT 1 FROM brain_jobs.jobs root_job
            WHERE root_job.id = admissions.root_job_id AND root_job.status = 'completed'
          )
          AND NOT EXISTS (
            SELECT 1 FROM brain_core.agent_runs runs
            WHERE runs.root_run_id = admissions.root_run_id
              AND runs.status IN ('queued', 'running')
          )
        RETURNING root_run_id
      )
      SELECT 1 FROM completed WHERE (SELECT COUNT(*) FROM released) >= 0
    `,
    [input.jobId, input.leaseOwner]
  );
  if (result.rowCount !== 1) throw new Error("Only the active lease owner can complete a job.");
}

export async function failJob(
  db: PostgresQueryable,
  input: {
    jobId: string;
    leaseOwner: string;
    now: Date;
    retryable: boolean;
    reason: string;
    retryDelayMs?: number;
    maxAttempts: number;
  }
): Promise<InternalJobV1> {
  const result = await db.query<JobRow>(
    `
      WITH failed AS (
      UPDATE brain_jobs.jobs
      SET
        status = CASE
          WHEN $3::boolean = true AND attempts + 1 < $4::integer THEN 'retry_wait'
          ELSE 'dead_letter'
        END,
        attempts = attempts + 1,
        available_at = CASE
          WHEN $3::boolean = true AND attempts + 1 < $4::integer
            THEN $5::timestamptz
          ELSE $6::timestamptz
        END,
        lease_owner = NULL,
        lease_expires_at = NULL,
        payload = payload || jsonb_build_object('lastError', $7::text),
        updated_at = $6::timestamptz
      WHERE id = $1
        AND lease_owner = $2
        AND status IN ('leased', 'running')
      RETURNING *
      ), released AS (
        UPDATE brain_core.root_run_admissions admissions
        SET state = 'released', terminal_reason = 'root_job_failed', released_at = $6::timestamptz
        WHERE admissions.root_job_id IN (SELECT id FROM failed)
        RETURNING root_run_id
      )
      SELECT failed.* FROM failed WHERE (SELECT COUNT(*) FROM released) >= 0
    `,
    [
      input.jobId,
      input.leaseOwner,
      input.retryable,
      input.maxAttempts,
      new Date(input.now.getTime() + (input.retryDelayMs ?? 0)).toISOString(),
      input.now.toISOString(),
      input.reason
    ]
  );
  return rowToJob(requireOne(result, "fail job"));
}
