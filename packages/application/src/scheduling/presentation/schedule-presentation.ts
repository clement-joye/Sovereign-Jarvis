import type { ScheduleDefinitionV1, ScheduledJobV1 } from "@second-brain/contracts";

export function formatSchedule(schedule: ScheduleDefinitionV1, displayTimezone: string): string {
  if (schedule.type === "once")
    return `Once at ${formatTimestampInTimezone(new Date(schedule.runAt), displayTimezone)}`;
  if (schedule.type === "cron") return `Cron \`${schedule.expression}\` (${schedule.timezone})`;
  return `Every ${schedule.seconds} seconds (${schedule.timezone})`;
}

export function formatScheduleSessionPolicy(policy: ScheduledJobV1["sessionPolicy"]): string {
  if (policy.type === "existing") return `Existing session \`${policy.sessionId}\``;
  return policy.type.charAt(0).toUpperCase() + policy.type.slice(1);
}

export function formatSchedulePolicy(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatTimestampInTimezone(timestamp: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(timestamp);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second} ${timeZone}`;
}
