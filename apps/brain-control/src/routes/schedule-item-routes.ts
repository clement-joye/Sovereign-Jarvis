import {
  ScheduleDeleteRequestV1Schema,
  ScheduleRunRequestV1Schema,
  ScheduleUpdateRequestV1Schema,
  ScheduleVersionRequestV1Schema
} from "@second-brain/contracts";

import { proposeScheduleMutation } from "./schedule-route-approval.js";
import { pathId } from "./schedule-route-authorization.js";
import { deserializeScheduleUpdate } from "./schedule-route-serialization.js";
import type { ScheduleRouteCall } from "./schedule-route-types.js";

interface ScheduleItemCall extends ScheduleRouteCall {
  id: string;
}

export async function handleScheduleItemRoute(call: ScheduleRouteCall): Promise<boolean> {
  if (!call.url.pathname.startsWith("/v1/schedules/")) return false;
  const [encodedId, action, extra] = call.url.pathname.slice("/v1/schedules/".length).split("/");
  if (extra !== undefined) return false;
  const method = call.request.method ?? "GET";
  if (!isItemRoute(method, action)) return false;
  const id = pathId(call.response, encodedId, call.dependencies.writeJson);
  if (id === undefined) return true;
  const itemCall = { ...call, id };

  if (method === "GET" && action === "history") return getHistory(itemCall);
  if (method === "GET") return getSchedule(itemCall);
  if (!(await matchesWorkspace(itemCall))) return true;
  if (method === "PATCH") return updateSchedule(itemCall);
  if (method === "DELETE") return deleteSchedule(itemCall);
  if (action === "enable" || action === "disable") {
    return setScheduleEnabled(itemCall, action === "enable");
  }
  return runScheduleNow(itemCall);
}

function isItemRoute(method: string, action: string | undefined): boolean {
  if (method === "GET") return action === undefined || action === "history";
  if (method === "PATCH" || method === "DELETE") return action === undefined;
  return method === "POST" && ["enable", "disable", "run"].includes(action ?? "");
}

async function getHistory(call: ScheduleItemCall): Promise<true> {
  if (!(await scheduleBelongsToWorkspace(call))) {
    call.dependencies.writeJson(call.response, 404, { error: "not_found" });
    return true;
  }
  call.dependencies.writeJson(
    call.response,
    200,
    await call.dependencies.scheduleService.history(call.id)
  );
  return true;
}

async function getSchedule(call: ScheduleItemCall): Promise<true> {
  const schedule = await call.dependencies.scheduleService.get(call.id);
  const visible = schedule && (!call.workspaceId || schedule.workspaceId === call.workspaceId);
  call.dependencies.writeJson(
    call.response,
    visible ? 200 : 404,
    visible ? schedule : { error: "not_found" }
  );
  return true;
}

async function updateSchedule(call: ScheduleItemCall): Promise<true> {
  const parsed = ScheduleUpdateRequestV1Schema.safeParse(
    await call.dependencies.readJson(call.request)
  );
  if (!parsed.success) {
    call.dependencies.writeJson(call.response, 400, {
      error: "invalid_schedule_update",
      issues: parsed.error.issues
    });
    return true;
  }
  if (
    call.workspaceId &&
    parsed.data.workspaceId !== undefined &&
    parsed.data.workspaceId !== call.workspaceId
  ) {
    call.dependencies.writeJson(call.response, 403, { error: "workspace_scope_mismatch" });
    return true;
  }
  if (
    await proposeScheduleMutation(call, {
      operation: "schedule-update",
      parameters: { id: call.id, request: parsed.data }
    })
  ) {
    return true;
  }
  call.dependencies.writeJson(
    call.response,
    200,
    await call.dependencies.scheduleService.update(deserializeScheduleUpdate(call.id, parsed.data))
  );
  return true;
}

async function deleteSchedule(call: ScheduleItemCall): Promise<true> {
  const parsed = ScheduleDeleteRequestV1Schema.safeParse(
    await call.dependencies.readJson(call.request)
  );
  if (!parsed.success) {
    call.dependencies.writeJson(call.response, 400, {
      error: "invalid_schedule_delete_request",
      issues: parsed.error.issues
    });
    return true;
  }
  if (
    await proposeScheduleMutation(call, {
      operation: "schedule-delete",
      parameters: { id: call.id, request: parsed.data }
    })
  ) {
    return true;
  }
  call.dependencies.writeJson(
    call.response,
    200,
    await call.dependencies.scheduleService.delete(call.id, parsed.data.expectedVersion)
  );
  return true;
}

async function setScheduleEnabled(call: ScheduleItemCall, enabled: boolean): Promise<true> {
  const parsed = ScheduleVersionRequestV1Schema.safeParse(
    await call.dependencies.readJson(call.request)
  );
  if (!parsed.success) {
    call.dependencies.writeJson(call.response, 400, {
      error: enabled ? "invalid_schedule_enable_request" : "invalid_schedule_disable_request",
      issues: parsed.error.issues
    });
    return true;
  }
  if (
    await proposeScheduleMutation(call, {
      operation: "schedule-update",
      parameters: {
        id: call.id,
        request: { expectedVersion: parsed.data.expectedVersion, enabled }
      }
    })
  ) {
    return true;
  }
  const result = enabled
    ? await call.dependencies.scheduleService.enable(call.id, parsed.data.expectedVersion)
    : await call.dependencies.scheduleService.disable(call.id, parsed.data.expectedVersion);
  call.dependencies.writeJson(call.response, 200, result);
  return true;
}

async function runScheduleNow(call: ScheduleItemCall): Promise<true> {
  const parsed = ScheduleRunRequestV1Schema.safeParse(
    await call.dependencies.readJson(call.request)
  );
  if (!parsed.success) {
    call.dependencies.writeJson(call.response, 400, {
      error: "invalid_schedule_run_request",
      issues: parsed.error.issues
    });
    return true;
  }
  const requestId = parsed.data.requestId ?? call.dependencies.ids.nextId("manual");
  if (
    await proposeScheduleMutation(call, {
      operation: "schedule-run-now",
      parameters: { id: call.id, request: { requestId } }
    })
  ) {
    return true;
  }
  call.dependencies.writeJson(
    call.response,
    202,
    await call.dependencies.scheduleService.runNow(call.id, requestId)
  );
  return true;
}

async function matchesWorkspace(call: ScheduleItemCall): Promise<boolean> {
  if (await scheduleBelongsToWorkspace(call)) return true;
  call.dependencies.writeJson(call.response, 404, { error: "not_found" });
  return false;
}

async function scheduleBelongsToWorkspace(call: ScheduleItemCall): Promise<boolean> {
  if (!call.workspaceId) return true;
  return (await call.dependencies.scheduleService.get(call.id))?.workspaceId === call.workspaceId;
}
