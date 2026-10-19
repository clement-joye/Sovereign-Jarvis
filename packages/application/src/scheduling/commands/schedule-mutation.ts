import type { ScheduledJobV1 } from "@second-brain/contracts";
import type { OccurrencePreview } from "@second-brain/schedule-engine";
import { requireWorkspaceId } from "@second-brain/domain";

import { requireScheduleDestination } from "../policy/schedule-destination.js";
import type { CreateScheduleInput, UpdateScheduleInput } from "./schedules.js";

const MAX_TIMEOUT_SECONDS = 86_400;

export function buildCreatedSchedule(input: {
  id: string;
  input: CreateScheduleInput;
  now: Date;
  preview: OccurrencePreview;
  defaultAgentId: string;
}): ScheduledJobV1 {
  const { id, input: scheduleInput, now, preview, defaultAgentId } = input;
  const enabled = scheduleInput.enabled ?? true;
  return {
    schemaVersion: 1,
    id,
    agentId: scheduleInput.agentId ?? defaultAgentId,
    workspaceId: scheduleInput.workspaceId,
    destinationConversationId: scheduleInput.destinationConversationId,
    ...(scheduleInput.destinationThreadRootExternalEventId
      ? { destinationThreadRootExternalEventId: scheduleInput.destinationThreadRootExternalEventId }
      : {}),
    name: scheduleInput.name.trim(),
    instruction: scheduleInput.instruction.trim(),
    schedule: scheduleInput.schedule,
    enabled,
    sessionPolicy: scheduleInput.sessionPolicy ?? { type: "fresh" },
    notificationPolicy: scheduleInput.notificationPolicy ?? "always",
    overlapPolicy: scheduleInput.overlapPolicy ?? "skip",
    missedRunPolicy: scheduleInput.missedRunPolicy ?? "run_once",
    timeoutSeconds: scheduleInput.timeoutSeconds ?? 600,
    ...(preview.nextRunAt && enabled ? { nextRunAt: preview.nextRunAt } : {}),
    version: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export function mergeScheduleUpdate(
  existing: ScheduledJobV1,
  input: UpdateScheduleInput
): CreateScheduleInput {
  const destinationConversationId = requireScheduleDestination({
    ...existing,
    ...(input.destinationConversationId
      ? { destinationConversationId: input.destinationConversationId }
      : {})
  });
  return {
    workspaceId: requireWorkspaceId(input.workspaceId ?? existing.workspaceId, "Schedule update"),
    destinationConversationId,
    ...(destinationConversationId === existing.destinationConversationId &&
    existing.destinationThreadRootExternalEventId
      ? { destinationThreadRootExternalEventId: existing.destinationThreadRootExternalEventId }
      : {}),
    agentId: input.agentId ?? existing.agentId,
    name: input.name ?? existing.name,
    instruction: input.instruction ?? existing.instruction,
    schedule: input.schedule ?? existing.schedule,
    enabled: input.enabled ?? existing.enabled,
    sessionPolicy: input.sessionPolicy ?? existing.sessionPolicy,
    notificationPolicy: input.notificationPolicy ?? existing.notificationPolicy,
    overlapPolicy: input.overlapPolicy ?? existing.overlapPolicy,
    missedRunPolicy: input.missedRunPolicy ?? existing.missedRunPolicy,
    timeoutSeconds: input.timeoutSeconds ?? existing.timeoutSeconds
  };
}

export function buildUpdatedSchedule(
  existing: ScheduledJobV1,
  input: CreateScheduleInput,
  preview: OccurrencePreview,
  now: Date
): ScheduledJobV1 {
  return {
    ...existing,
    ...input,
    destinationThreadRootExternalEventId: input.destinationThreadRootExternalEventId,
    nextRunAt: input.enabled ? preview.nextRunAt : undefined,
    version: existing.version + 1,
    updatedAt: now.toISOString()
  };
}

export function validateScheduleInput(input: CreateScheduleInput): void {
  if (input.name.trim().length === 0 || input.name.length > 120) {
    throw new Error("Schedule name must be 1-120 characters.");
  }
  if (input.instruction.trim().length === 0 || input.instruction.length > 10_000) {
    throw new Error("Schedule instruction must be 1-10000 characters.");
  }
  if (input.timeoutSeconds !== undefined && input.timeoutSeconds > MAX_TIMEOUT_SECONDS) {
    throw new Error(`Schedule timeout cannot exceed ${MAX_TIMEOUT_SECONDS} seconds.`);
  }
}
