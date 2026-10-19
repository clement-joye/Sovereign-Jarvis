import type { RootRunAdmissionSnapshot } from "@second-brain/application/ports/jobs";
import type { QueryResultRow } from "pg";

import type { PostgresQueryable } from "./postgres-queryable.js";
import { toIso } from "./postgres-job-row.js";

interface AdmissionSnapshotRow extends QueryResultRow {
  root_run_id: string | null;
  root_job_id: string | null;
  workspace_id: string | null;
  lease_owner: string | null;
  acquired_at: Date | string | null;
  heartbeat_at: Date | string | null;
  expires_at: Date | string | null;
  queue_depth: number;
  waiting_schedules: number;
  oldest_waiting_root: string | null;
  oldest_waiting_at: Date | string | null;
}

export async function snapshotRootAdmission(
  db: PostgresQueryable,
  limit: number,
  now: Date
): Promise<RootRunAdmissionSnapshot> {
  const result = await db.query<AdmissionSnapshotRow>(
    `
      WITH active AS (
        SELECT * FROM brain_core.root_run_admissions
        WHERE state = 'active' AND expires_at > $1::timestamptz
      ), waiting AS (
        SELECT * FROM brain_jobs.jobs jobs
        WHERE jobs.status IN ('pending', 'retry_wait')
          AND jobs.type IN ('process_inbound', 'run_schedule')
          AND (jobs.type <> 'process_inbound' OR jobs.payload->>'requiresRootAdmission' IS DISTINCT FROM 'false')
      )
      SELECT active.*, counts.queue_depth, counts.waiting_schedules,
             counts.oldest_waiting_root, counts.oldest_waiting_at
      FROM (
        SELECT COUNT(*)::integer AS queue_depth,
               COUNT(*) FILTER (WHERE type = 'run_schedule')::integer AS waiting_schedules,
               (array_agg(id ORDER BY available_at ASC, id ASC))[1] AS oldest_waiting_root,
               (array_agg(available_at ORDER BY available_at ASC, id ASC))[1] AS oldest_waiting_at
        FROM waiting
      ) counts
      LEFT JOIN active ON true
      ORDER BY active.acquired_at ASC, active.root_run_id ASC
    `,
    [now.toISOString()]
  );
  const first = result.rows[0];
  const roots = result.rows
    .filter((row) => row.root_run_id !== null)
    .map((row) => ({
      rootRunId: row.root_run_id!,
      rootJobId: row.root_job_id!,
      workspaceId: row.workspace_id!,
      leaseOwner: row.lease_owner!,
      acquiredAt: toIso(row.acquired_at!),
      heartbeatAt: toIso(row.heartbeat_at!),
      expiresAt: toIso(row.expires_at!),
      leaseAgeMs: Math.max(0, now.getTime() - new Date(row.acquired_at!).getTime())
    }));
  return {
    limit,
    activeRoots: roots.length,
    queueDepth: first?.queue_depth ?? 0,
    ...(first?.oldest_waiting_root && first.oldest_waiting_at
      ? {
          oldestWaitingRoot: {
            jobId: first.oldest_waiting_root,
            availableAt: toIso(first.oldest_waiting_at),
            waitMs: Math.max(0, now.getTime() - new Date(first.oldest_waiting_at).getTime())
          }
        }
      : {}),
    waitingSchedules: first?.waiting_schedules ?? 0,
    roots
  };
}
