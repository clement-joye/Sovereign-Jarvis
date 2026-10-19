import type { IncomingMessage, ServerResponse } from "node:http";

import { parseOpaquePathParameter } from "./path-parameters.js";
import type {
  ScheduleRouteAccess,
  ScheduleRouteDependencies,
  WriteJson
} from "./schedule-route-types.js";

type AuthorizationResult = { accepted: true; access: ScheduleRouteAccess } | { accepted: false };

export function authorizeScheduleRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  dependencies: ScheduleRouteDependencies
): AuthorizationResult {
  const workspaceScope = request.headers["x-jarvis-workspace-id"];
  const scopeWasRequested =
    request.headers.authorization !== undefined || workspaceScope !== undefined;
  const runAuthorization =
    typeof workspaceScope === "string"
      ? dependencies.runAuthorizations?.verify(bearerToken(request), {
          workspaceId: workspaceScope,
          requiredTool: scheduleTool(request.method ?? "GET", url.pathname)
        })
      : undefined;

  if (!isAuthorizedRequest(request, dependencies, scopeWasRequested, runAuthorization)) {
    dependencies.writeJson(response, 401, { error: "schedule_unauthorized" });
    return { accepted: false };
  }
  const workspaceId =
    dependencies.scheduleToken || dependencies.runAuthorizations ? workspaceScope : undefined;
  if (Array.isArray(workspaceId)) {
    dependencies.writeJson(response, 400, { error: "invalid_workspace_scope" });
    return { accepted: false };
  }
  return { accepted: true, access: { workspaceId, runAuthorization } };
}

export function mutationIdempotencyKey(request: IncomingMessage): string | undefined {
  const value = request.headers["x-jarvis-idempotency-key"];
  return typeof value === "string" && value.length > 0 && value.length <= 512 ? value : undefined;
}

export function pathId(
  response: ServerResponse,
  encodedValue: string | undefined,
  writeJson: WriteJson
): string | undefined {
  const id = parseOpaquePathParameter(encodedValue);
  if (id === undefined) writeJson(response, 400, { error: "invalid_path_parameter" });
  return id;
}

function isAuthorizedRequest(
  request: IncomingMessage,
  dependencies: ScheduleRouteDependencies,
  scopeWasRequested: boolean,
  runAuthorization: object | undefined
): boolean {
  if (!scopeWasRequested || runAuthorization) return true;
  return Boolean(
    dependencies.scheduleToken && hasScheduleAuthorization(request, dependencies.scheduleToken)
  );
}

function scheduleTool(method: string, path: string): string {
  if (method === "POST" && path === "/v1/schedules") return "schedule_create";
  if (method === "DELETE") return "schedule_delete";
  if (method === "PATCH") return "schedule_update";
  if (method === "POST" && path.endsWith("/run")) return "schedule_run";
  if (method === "POST" && (path.endsWith("/enable") || path.endsWith("/disable"))) {
    return "schedule_update";
  }
  return "schedule_list";
}

function bearerToken(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization;
  return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
}

function hasScheduleAuthorization(request: IncomingMessage, token: string): boolean {
  return request.headers.authorization === `Bearer ${token}`;
}
