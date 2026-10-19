import type { CreateScheduleInput, UpdateScheduleInput } from "@second-brain/application";
import type { ScheduleCreateRequestV1, ScheduleUpdateRequestV1 } from "@second-brain/contracts";

export function deserializeScheduleCreate(
  input: ScheduleCreateRequestV1,
  workspaceId?: string
): CreateScheduleInput {
  const effectiveWorkspaceId = workspaceId ?? input.workspaceId;
  if (!effectiveWorkspaceId) throw new Error("Schedule creation requires a workspace ID.");
  if (!input.destinationConversationId) {
    throw new Error("Schedule creation requires a destination conversation.");
  }
  return {
    workspaceId: effectiveWorkspaceId,
    destinationConversationId: input.destinationConversationId,
    ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
    name: input.name,
    instruction: input.instruction,
    schedule: input.schedule,
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.sessionPolicy !== undefined ? { sessionPolicy: input.sessionPolicy } : {}),
    ...(input.notificationPolicy !== undefined
      ? { notificationPolicy: input.notificationPolicy }
      : {}),
    ...(input.overlapPolicy !== undefined ? { overlapPolicy: input.overlapPolicy } : {}),
    ...(input.missedRunPolicy !== undefined ? { missedRunPolicy: input.missedRunPolicy } : {}),
    ...(input.timeoutSeconds !== undefined ? { timeoutSeconds: input.timeoutSeconds } : {})
  };
}

export function deserializeScheduleUpdate(
  id: string,
  input: ScheduleUpdateRequestV1
): UpdateScheduleInput {
  return {
    id,
    expectedVersion: input.expectedVersion,
    ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
    ...(input.destinationConversationId !== undefined
      ? { destinationConversationId: input.destinationConversationId }
      : {}),
    ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.instruction !== undefined ? { instruction: input.instruction } : {}),
    ...(input.schedule !== undefined ? { schedule: input.schedule } : {}),
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.sessionPolicy !== undefined ? { sessionPolicy: input.sessionPolicy } : {}),
    ...(input.notificationPolicy !== undefined
      ? { notificationPolicy: input.notificationPolicy }
      : {}),
    ...(input.overlapPolicy !== undefined ? { overlapPolicy: input.overlapPolicy } : {}),
    ...(input.missedRunPolicy !== undefined ? { missedRunPolicy: input.missedRunPolicy } : {}),
    ...(input.timeoutSeconds !== undefined ? { timeoutSeconds: input.timeoutSeconds } : {})
  };
}
