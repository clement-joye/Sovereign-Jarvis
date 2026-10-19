import type { ScheduledJobV1 } from "@second-brain/contracts";

/** Returns the room explicitly captured when the schedule was created. */
export function requireScheduleDestination(schedule: ScheduledJobV1): string {
  if (!schedule.destinationConversationId) {
    throw new Error(`Schedule ${schedule.id} has no destination conversation.`);
  }
  return schedule.destinationConversationId;
}
