import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { ActionProposalPendingV1Schema } from "@second-brain/contracts";
import type {
  ScheduleControlPort,
  ScheduleCreateInput
} from "../clients/schedule-control-client.js";
import {
  scheduleInput,
  scheduleMutationParameters,
  type ScheduleToolInput,
  type ScheduleToolOptions
} from "./schedule-tool-input.js";

export type { ScheduleToolOptions } from "./schedule-tool-input.js";

export interface ScheduleToolEvent {
  operation: "list" | "create" | "update" | "delete" | "run_now";
  status: "started" | "succeeded" | "failed";
}
type ScheduleToolEventHandler = (event: ScheduleToolEvent) => void;

export function createScheduleTools(
  control: ScheduleControlPort,
  onEvent?: ScheduleToolEventHandler,
  options: ScheduleToolOptions = {}
): ToolDefinition[] {
  return [
    createListTool(control, onEvent),
    createCreateTool(control, onEvent, options),
    createUpdateTool(control, onEvent, options),
    createDeleteTool(control, onEvent),
    createRunNowTool(control, onEvent)
  ];
}

function createListTool(control: ScheduleControlPort, onEvent?: ScheduleToolEventHandler) {
  return defineTool({
    name: "schedule_list",
    label: "schedule_list",
    description:
      "List durable Jarvis schedules, including each executor agent, ID, and version for safe updates or deletion.",
    promptSnippet: "List schedules",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      return executeScheduleTool("list", () => control.list(signal), onEvent);
    }
  });
}

function createCreateTool(
  control: ScheduleControlPort,
  onEvent: ScheduleToolEventHandler | undefined,
  options: ScheduleToolOptions
) {
  const timezoneGuidance = options.defaultTimezone
    ? `Interpret an unspecified user timezone as ${options.defaultTimezone}.`
    : "The user's timezone is unknown, so require an explicit timezone before scheduling.";
  return defineTool({
    name: "schedule_create",
    label: "schedule_create",
    description: `Create a durable one-time, cron, or interval schedule. Replies go to the current Matrix thread by default when one exists; set deliveryThread to new for a separate thread. ${timezoneGuidance} Ask which reviewed agent should execute the schedule when the requested work could belong to more than one agent. If omitted, Brain is persisted as the executor. For a relative one-time request, call time_now first. A one-time runAt must be an ISO-8601 timestamp with an explicit UTC offset. Specify overlap and missed-run policies explicitly for recurring work when they matter.`,
    promptSnippet: "Request creation of a schedule",
    parameters: Type.Intersect([
      scheduleMutationParameters(false),
      Type.Object({
        deliveryThread: Type.Optional(Type.Union([Type.Literal("current"), Type.Literal("new")]))
      })
    ]),
    async execute(id, params, signal) {
      return executeScheduleTool(
        "create",
        () =>
          control.create(
            scheduleInput(params as ScheduleToolInput, false, options) as ScheduleCreateInput,
            id,
            signal
          ),
        onEvent
      );
    }
  });
}

function createUpdateTool(
  control: ScheduleControlPort,
  onEvent: ScheduleToolEventHandler | undefined,
  options: ScheduleToolOptions
) {
  return defineTool({
    name: "schedule_update",
    label: "schedule_update",
    description: "Update a schedule after listing it. Supply its current version.",
    promptSnippet: "Request an update to a schedule",
    parameters: Type.Intersect([
      Type.Object({ id: Type.String(), expectedVersion: Type.Number() }),
      scheduleMutationParameters(true)
    ]),
    async execute(callId, params, signal) {
      const input = params as ScheduleToolInput & { id: string; expectedVersion: number };
      return executeScheduleTool(
        "update",
        () =>
          control.update(
            input.id,
            { ...scheduleInput(input, true, options), expectedVersion: input.expectedVersion },
            callId,
            signal
          ),
        onEvent
      );
    }
  });
}

function createDeleteTool(control: ScheduleControlPort, onEvent?: ScheduleToolEventHandler) {
  return defineTool({
    name: "schedule_delete",
    label: "schedule_delete",
    description: "Permanently remove a schedule. List schedules first to obtain ID and version.",
    promptSnippet: "Request deletion of a schedule",
    parameters: Type.Object({ id: Type.String(), expectedVersion: Type.Number() }),
    async execute(callId, params, signal) {
      const input = params as { id: string; expectedVersion: number };
      return executeScheduleTool(
        "delete",
        () => control.delete(input.id, input.expectedVersion, callId, signal),
        onEvent
      );
    }
  });
}

function createRunNowTool(control: ScheduleControlPort, onEvent?: ScheduleToolEventHandler) {
  return defineTool({
    name: "schedule_run_now",
    label: "schedule_run_now",
    description: "Queue one immediate execution of an existing schedule.",
    promptSnippet: "Request an immediate schedule run",
    parameters: Type.Object({ id: Type.String() }),
    async execute(callId, params, signal) {
      const input = params as { id: string };
      return executeScheduleTool(
        "run_now",
        () => control.runNow(input.id, callId, signal),
        onEvent
      );
    }
  });
}

async function executeScheduleTool(
  operation: ScheduleToolEvent["operation"],
  action: () => Promise<unknown>,
  onEvent?: ScheduleToolEventHandler
) {
  reportEvent(operation, "started", onEvent);
  try {
    const result = await action();
    reportEvent(operation, "succeeded", onEvent);
    return textResult(result);
  } catch (error) {
    reportEvent(operation, "failed", onEvent, error);
    throw error;
  }
}

function reportEvent(
  operation: ScheduleToolEvent["operation"],
  status: ScheduleToolEvent["status"],
  onEvent?: ScheduleToolEventHandler,
  error?: unknown
): void {
  onEvent?.({ operation, status });
  const details = {
    service: "pi-runner",
    event: "schedule-tool",
    operation,
    status,
    ...(error === undefined
      ? {}
      : { error: error instanceof Error ? error.message : "Unknown schedule-tool error" })
  };
  if (status === "failed") console.error(JSON.stringify(details));
  else console.info(JSON.stringify(details));
}

function textResult(value: unknown) {
  const pending = ActionProposalPendingV1Schema.safeParse(value);
  const text = pending.success
    ? "A schedule change was proposed, but no schedule was created yet. Only the owner can approve it through Jarvis's separate approval message; approval is never automatic. Do not retry because schedule_list omits pending proposals. Do not claim the schedule is active or will run."
    : JSON.stringify(value);
  return { content: [{ type: "text" as const, text }], details: {} };
}
