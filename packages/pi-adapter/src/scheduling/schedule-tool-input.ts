import { Type, type TSchema } from "@earendil-works/pi-ai";
import type { AgentIdV1, SessionPolicyV1 } from "@second-brain/contracts";
import type { ScheduleCreateInput } from "../clients/schedule-control-client.js";

export interface ScheduleToolOptions {
  defaultTimezone?: string | undefined;
  workspaceId?: string | undefined;
  destinationConversationId?: string | undefined;
  destinationThreadRootExternalEventId?: string | undefined;
}
export interface ScheduleToolInput {
  name?: string;
  instruction?: string;
  agentId?: AgentIdV1;
  scheduleType?: "once" | "cron" | "interval";
  runAt?: string;
  cronExpression?: string;
  intervalSeconds?: number;
  timezone?: string;
  sessionPolicy?: SessionPolicyV1;
  notificationPolicy?: ScheduleCreateInput["notificationPolicy"];
  overlapPolicy?: ScheduleCreateInput["overlapPolicy"];
  missedRunPolicy?: ScheduleCreateInput["missedRunPolicy"];
  timeoutSeconds?: number;
  deliveryThread?: "current" | "new";
}

export function scheduleMutationParameters(optional: boolean) {
  const value = (schema: TSchema) => (optional ? Type.Optional(schema) : schema);
  return Type.Object({
    name: value(Type.String()),
    instruction: value(Type.String()),
    agentId: Type.Optional(Type.String()),
    scheduleType: value(
      Type.Union([Type.Literal("once"), Type.Literal("cron"), Type.Literal("interval")])
    ),
    runAt: Type.Optional(Type.String()),
    cronExpression: Type.Optional(Type.String()),
    intervalSeconds: Type.Optional(Type.Number()),
    timezone: Type.Optional(Type.String()),
    notificationPolicy: Type.Optional(
      Type.Union([
        Type.Literal("always"),
        Type.Literal("on_change"),
        Type.Literal("on_failure"),
        Type.Literal("never")
      ])
    ),
    sessionPolicy: Type.Optional(
      Type.Union([
        Type.Object({ type: Type.Literal("fresh") }),
        Type.Object({ type: Type.Literal("dedicated") }),
        Type.Object({ type: Type.Literal("existing"), sessionId: Type.String() })
      ])
    ),
    overlapPolicy: Type.Optional(Type.Union([Type.Literal("skip"), Type.Literal("queue")])),
    missedRunPolicy: Type.Optional(Type.Union([Type.Literal("skip"), Type.Literal("run_once")])),
    timeoutSeconds: Type.Optional(Type.Number({ minimum: 1, maximum: 86_400 }))
  });
}

export function scheduleInput(
  input: ScheduleToolInput,
  partial = false,
  options: ScheduleToolOptions = {}
): Partial<ScheduleCreateInput> {
  const result: Partial<ScheduleCreateInput> = definedFields({
    workspaceId: options.workspaceId,
    destinationConversationId: partial ? undefined : options.destinationConversationId,
    destinationThreadRootExternalEventId: partial
      ? undefined
      : destinationThread(input.deliveryThread, options.destinationThreadRootExternalEventId),
    agentId: input.agentId,
    name: input.name,
    instruction: input.instruction,
    notificationPolicy: input.notificationPolicy,
    sessionPolicy: input.sessionPolicy,
    overlapPolicy: input.overlapPolicy,
    missedRunPolicy: input.missedRunPolicy,
    timeoutSeconds: input.timeoutSeconds
  });
  const schedule = scheduleDefinition(input, partial, options.defaultTimezone);
  if (schedule) result.schedule = schedule;
  if (!partial && (!result.name || !result.instruction || !result.schedule))
    throw new Error("name, instruction, and a complete schedule are required.");
  return result;
}

function destinationThread(
  deliveryThread: ScheduleToolInput["deliveryThread"],
  currentThreadRoot: string | undefined
): string | undefined {
  if (deliveryThread === "new") return undefined;
  if (deliveryThread === "current" && !currentThreadRoot) {
    throw new Error("The current message has no Matrix thread to schedule into.");
  }
  return currentThreadRoot;
}

function definedFields<T extends object>(fields: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  ) as unknown as { [K in keyof T]?: Exclude<T[K], undefined> };
}

function scheduleDefinition(
  input: ScheduleToolInput,
  partial: boolean,
  defaultTimezone?: string
): ScheduleCreateInput["schedule"] | undefined {
  if (input.scheduleType === undefined) {
    if (!partial) throw new Error("scheduleType is required.");
    return undefined;
  }
  if (input.scheduleType === "once") {
    if (!input.runAt) throw new Error("One-time schedules require runAt as an ISO timestamp.");
    return { type: "once", runAt: input.runAt };
  }
  const timezone = requireTimezone(input.timezone ?? defaultTimezone);
  if (input.scheduleType === "cron") {
    if (!input.cronExpression) throw new Error("Cron schedules require cronExpression.");
    return { type: "cron", expression: input.cronExpression, timezone };
  }
  if (!input.intervalSeconds) throw new Error("Interval schedules require intervalSeconds.");
  return { type: "interval", seconds: input.intervalSeconds, timezone };
}

function requireTimezone(timezone: string | undefined): string {
  if (!timezone) throw new Error("A timezone is required before creating a recurring schedule.");
  return timezone;
}
