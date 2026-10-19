import type { InternalJobV1, ScheduledExecutionV1, ScheduledJobV1 } from "@second-brain/contracts";
import { previewSchedule } from "@second-brain/schedule-engine";
import { requireWorkspaceId, type IdGeneratorPort } from "@second-brain/domain";

import type { ExecutionRepositoryPort, JobQueuePort, ScheduleRepositoryPort } from "../../ports.js";

export interface ClaimDueSchedulesInput {
  schedules: ScheduleRepositoryPort;
  executions: ExecutionRepositoryPort;
  jobs: JobQueuePort;
  now: Date;
  limit: number;
  ids: IdGeneratorPort;
}

/** Applies occurrence, overlap, and missed-run policy inside the caller's persistence boundary. */
export async function claimDueSchedules(
  input: ClaimDueSchedulesInput
): Promise<ScheduledExecutionV1[]> {
  const due = await input.schedules.claimDue({ now: input.now, limit: input.limit });
  const claimed: ScheduledExecutionV1[] = [];
  for (const schedule of due) {
    const scheduledFor = schedule.nextRunAt;
    if (!scheduledFor) continue;
    const missed = new Date(scheduledFor).getTime() < input.now.getTime();
    if (missed && schedule.missedRunPolicy === "skip") {
      await advanceStoredSchedule(input, schedule, scheduledFor, true);
      continue;
    }
    const execution = await createClaimedExecution(input, schedule, scheduledFor);
    claimed.push(execution);
    await advanceStoredSchedule(input, schedule, scheduledFor, missed);
  }
  return claimed;
}

async function createClaimedExecution(
  input: ClaimDueSchedulesInput,
  schedule: ScheduledJobV1,
  scheduledFor: string
): Promise<ScheduledExecutionV1> {
  const active = await input.executions.findActiveBySchedule(schedule.id);
  const stored = await input.executions.create(
    buildScheduledExecution({
      scheduleId: schedule.id,
      scheduledFor,
      now: input.now,
      ...(active && schedule.overlapPolicy === "skip" ? { status: "skipped" } : {})
    })
  );
  if (!stored.duplicate && stored.execution.status !== "skipped") {
    await input.jobs.enqueue(
      buildRunScheduleJob({
        id: input.ids.nextId("job"),
        schedule,
        execution: stored.execution,
        now: input.now
      })
    );
  }
  return stored.execution;
}

async function advanceStoredSchedule(
  input: ClaimDueSchedulesInput,
  schedule: ScheduledJobV1,
  scheduledFor: string,
  advanceFromNow: boolean
): Promise<void> {
  await input.schedules.update(
    advanceScheduleAfterClaim({ schedule, scheduledFor, now: input.now, advanceFromNow }),
    schedule.version
  );
}

export function buildScheduledExecution(input: {
  scheduleId: string;
  scheduledFor: string;
  now: Date;
  status?: ScheduledExecutionV1["status"];
  manualRequestId?: string;
}): ScheduledExecutionV1 {
  return {
    schemaVersion: 1,
    id: input.manualRequestId
      ? `execution-${input.scheduleId}-manual-${input.manualRequestId}`
      : `execution-${input.scheduleId}-${input.scheduledFor}`,
    scheduleId: input.scheduleId,
    scheduledFor: input.scheduledFor,
    status: input.status ?? "queued",
    attempt: 0,
    createdAt: input.now.toISOString()
  };
}

export function buildRunScheduleJob(input: {
  id: string;
  schedule: ScheduledJobV1;
  execution: ScheduledExecutionV1;
  now: Date;
}): InternalJobV1 {
  return {
    schemaVersion: 1,
    id: input.id,
    workspaceId: requireWorkspaceId(input.schedule.workspaceId, "Schedule job"),
    type: "run_schedule",
    payload: {
      scheduleId: input.schedule.id,
      executionId: input.execution.id,
      agentId: input.schedule.agentId
    },
    priority: 60,
    status: "pending",
    attempts: 0,
    availableAt: input.now.toISOString(),
    idempotencyKey: `run_schedule:${input.execution.id}`
  };
}

export function advanceScheduleAfterClaim(input: {
  schedule: ScheduledJobV1;
  scheduledFor: string;
  now: Date;
  advanceFromNow?: boolean;
}): ScheduledJobV1 {
  const next = previewSchedule(input.schedule.schedule, {
    now: input.advanceFromNow ? input.now : new Date(input.scheduledFor),
    count: 1
  }).nextRunAt;
  return omitUndefinedNextRunAt({
    ...input.schedule,
    enabled: input.schedule.enabled,
    nextRunAt: input.schedule.schedule.type === "once" ? undefined : next,
    lastRunAt: input.scheduledFor,
    version: input.schedule.version + 1,
    updatedAt: input.now.toISOString()
  });
}

export function omitUndefinedNextRunAt(schedule: ScheduledJobV1): ScheduledJobV1 {
  if (schedule.nextRunAt !== undefined) return schedule;
  const copy = { ...schedule };
  delete copy.nextRunAt;
  return copy;
}
