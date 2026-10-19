import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

export interface CurrentTimeToolOptions {
  timezone?: string | undefined;
  now?: () => Date;
}

/** Builds the live clock context supplied to every Pi agent turn. */
export function currentTimeContext(instant: Date, timezone?: string): string {
  const localTime = timezone ? `; local (${timezone}): ${formatInTimezone(instant, timezone)}` : "";
  return `[Current time: ${instant.toISOString()} UTC${localTime}.]`;
}

/** Returns the authoritative current instant in both UTC and the user's timezone. */
export function createCurrentTimeTool(options: CurrentTimeToolOptions): ToolDefinition {
  const now = options.now ?? (() => new Date());
  return defineTool({
    name: "time_now",
    label: "time_now",
    description:
      "Get the authoritative current date and time in the user's configured timezone and UTC. Use this before creating a one-time schedule from a relative time such as today, tomorrow, or in two hours.",
    promptSnippet: "Get the current time before resolving a relative one-time schedule",
    parameters: Type.Object({}),
    async execute() {
      const instant = now();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              utc: instant.toISOString(),
              ...(options.timezone
                ? {
                    timezone: options.timezone,
                    local: formatInTimezone(instant, options.timezone)
                  }
                : { timezone: null })
            })
          }
        ],
        details: {}
      };
    }
  });
}

function formatInTimezone(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset"
  }).formatToParts(instant);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}${values.timeZoneName?.replace("GMT", "") ?? ""}`;
}
