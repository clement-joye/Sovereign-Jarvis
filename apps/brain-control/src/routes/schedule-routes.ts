import type { IncomingMessage, ServerResponse } from "node:http";

import { handleScheduleCollectionRoute } from "./schedule-collection-routes.js";
import { handleScheduleItemRoute } from "./schedule-item-routes.js";
import { authorizeScheduleRoute } from "./schedule-route-authorization.js";
import type { ScheduleRouteDependencies } from "./schedule-route-types.js";

export type { ScheduleRouteDependencies } from "./schedule-route-types.js";

export async function handleScheduleRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  dependencies: ScheduleRouteDependencies
): Promise<boolean> {
  if (!url.pathname.startsWith("/v1/schedules")) return false;
  const authorization = authorizeScheduleRoute(request, response, url, dependencies);
  if (!authorization.accepted) return true;
  const call = { request, response, url, dependencies, ...authorization.access };
  if (await handleScheduleCollectionRoute(call)) return true;
  return handleScheduleItemRoute(call);
}
