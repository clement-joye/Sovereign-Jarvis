import type { IncomingMessage, ServerResponse } from "node:http";

import {
  plannerDelegationRouteHandlers,
  type PlannerDelegationDependencies,
  type PlannerDelegationRouteContext
} from "./planner-delegation-route-handlers.js";

export { waitForChild } from "./planner-delegation-route-handlers.js";

export async function handlePlannerDelegationRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  deps: PlannerDelegationDependencies
): Promise<boolean> {
  if (!isPlannerRoute(url.pathname)) return false;

  const bearer = bearerToken(request);
  if (!deps.runAuthorizations) {
    deps.writeJson(response, 401, { error: "planner_delegation_unauthorized" });
    return true;
  }

  const context: PlannerDelegationRouteContext = {
    request,
    response,
    url,
    method: request.method ?? "GET",
    bearer,
    deps
  };
  for (const handler of plannerDelegationRouteHandlers) {
    if (await handler(context)) return true;
  }
  return false;
}

function isPlannerRoute(pathname: string): boolean {
  return pathname === "/v1/planner-delegations" || pathname.startsWith("/v1/agent-runs/");
}

function bearerToken(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization;
  return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
}
