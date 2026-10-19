import {
  ScheduleClaimDueRequestV1Schema,
  ScheduleCreateRequestV1Schema
} from "@second-brain/contracts";

import { proposeScheduleMutation } from "./schedule-route-approval.js";
import { deserializeScheduleCreate } from "./schedule-route-serialization.js";
import type { ScheduleRouteCall } from "./schedule-route-types.js";

export async function handleScheduleCollectionRoute(call: ScheduleRouteCall): Promise<boolean> {
  const method = call.request.method ?? "GET";
  if (call.url.pathname === "/v1/schedules" && method === "POST") {
    return createSchedule(call);
  }
  if (call.url.pathname === "/v1/schedules" && method === "GET") {
    return listSchedules(call);
  }
  if (call.url.pathname === "/v1/schedules/claim-due" && method === "POST") {
    return claimDueSchedules(call);
  }
  return false;
}

async function createSchedule(call: ScheduleRouteCall): Promise<true> {
  const { request, response, dependencies, workspaceId } = call;
  const parsed = ScheduleCreateRequestV1Schema.safeParse(await dependencies.readJson(request));
  if (!parsed.success) {
    dependencies.writeJson(response, 400, {
      error: "invalid_schedule_create",
      issues: parsed.error.issues
    });
    return true;
  }
  if (workspaceId && parsed.data.workspaceId && parsed.data.workspaceId !== workspaceId) {
    dependencies.writeJson(response, 403, { error: "workspace_scope_mismatch" });
    return true;
  }
  if (
    await proposeScheduleMutation(call, {
      operation: "schedule-create",
      parameters: { request: parsed.data }
    })
  ) {
    return true;
  }
  dependencies.writeJson(
    response,
    201,
    await dependencies.scheduleService.create(deserializeScheduleCreate(parsed.data, workspaceId))
  );
  return true;
}

async function listSchedules(call: ScheduleRouteCall): Promise<true> {
  const schedules = await call.dependencies.scheduleService.list();
  call.dependencies.writeJson(
    call.response,
    200,
    call.workspaceId
      ? schedules.filter((schedule) => schedule.workspaceId === call.workspaceId)
      : schedules
  );
  return true;
}

async function claimDueSchedules(call: ScheduleRouteCall): Promise<true> {
  const { request, response, dependencies } = call;
  const parsed = ScheduleClaimDueRequestV1Schema.safeParse(await dependencies.readJson(request));
  if (!parsed.success) {
    dependencies.writeJson(response, 400, {
      error: "invalid_schedule_claim_request",
      issues: parsed.error.issues
    });
    return true;
  }
  dependencies.writeJson(
    response,
    200,
    await dependencies.scheduleService.claimDue(parsed.data.limit ?? 10)
  );
  return true;
}
