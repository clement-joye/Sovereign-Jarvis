import { ScheduledJobV1Schema, type ScheduledJobV1 } from "@second-brain/contracts/schemas";
import { requireWorkspaceId } from "@second-brain/domain";

export interface ScheduleRow {
  id: string;
  workspace_id: string;
  destination_conversation_id: string | null;
  destination_thread_root_external_event_id: string | null;
  agent_id?: string | null;
  schema_version: number;
  name: string;
  instruction: string;
  schedule: unknown;
  enabled: boolean;
  session_policy: unknown;
  notification_policy: string;
  overlap_policy: string;
  missed_run_policy: string;
  timeout_seconds: number | string;
  next_run_at: Date | string | null;
  last_run_at: Date | string | null;
  version: number | string;
  created_at: Date | string;
  updated_at: Date | string;
}

export function scheduleValues(job: ScheduledJobV1) {
  return {
    id: job.id,
    workspace_id: requireWorkspaceId(job.workspaceId, "Schedule persistence"),
    destination_conversation_id: job.destinationConversationId ?? null,
    destination_thread_root_external_event_id: job.destinationThreadRootExternalEventId ?? null,
    agent_id: job.agentId,
    schema_version: job.schemaVersion,
    name: job.name,
    instruction: job.instruction,
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
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    deleted_at: null
  };
}

export function rowToSchedule(row: ScheduleRow): ScheduledJobV1 {
  return ScheduledJobV1Schema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    workspaceId: row.workspace_id,
    ...(row.destination_conversation_id
      ? { destinationConversationId: row.destination_conversation_id }
      : {}),
    ...(row.destination_thread_root_external_event_id
      ? { destinationThreadRootExternalEventId: row.destination_thread_root_external_event_id }
      : {}),
    agentId: row.agent_id ?? "brain",
    name: row.name,
    instruction: row.instruction,
    schedule: normalizeLegacyScheduleDefinition(row.schedule),
    enabled: row.enabled,
    sessionPolicy: row.session_policy,
    notificationPolicy: row.notification_policy,
    overlapPolicy: row.overlap_policy,
    missedRunPolicy: row.missed_run_policy,
    timeoutSeconds: Number(row.timeout_seconds),
    ...(row.next_run_at ? { nextRunAt: toIso(row.next_run_at) } : {}),
    ...(row.last_run_at ? { lastRunAt: toIso(row.last_run_at) } : {}),
    version: Number(row.version),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  });
}

function normalizeLegacyScheduleDefinition(schedule: unknown): unknown {
  if (!isLegacyOffsetlessOnceSchedule(schedule)) return schedule;
  const date = new Date(`${schedule.runAt}Z`);
  return Number.isNaN(date.getTime()) ? schedule : { ...schedule, runAt: date.toISOString() };
}

function isLegacyOffsetlessOnceSchedule(
  schedule: unknown
): schedule is { type: "once"; runAt: string } {
  if (!schedule || typeof schedule !== "object") return false;
  const candidate = schedule as { type?: unknown; runAt?: unknown };
  return (
    candidate.type === "once" &&
    typeof candidate.runAt === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(candidate.runAt)
  );
}

export function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
