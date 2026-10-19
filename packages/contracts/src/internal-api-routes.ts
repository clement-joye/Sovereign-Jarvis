import type { InternalApiRoute } from "./internal-api-route-types.js";
import { WorkspaceInternalApiRoutes } from "./internal-api-routes/workspace-routes.js";
import { InboundInternalApiRoutes } from "./internal-api-routes/inbound-routes.js";
import { OutboundInternalApiRoutes } from "./internal-api-routes/outbound-routes.js";
import { JobsInternalApiRoutes } from "./internal-api-routes/jobs-routes.js";
import { SchedulesInternalApiRoutes } from "./internal-api-routes/schedules-routes.js";
import { SessionsInternalApiRoutes } from "./internal-api-routes/sessions-routes.js";
import { AdminInternalApiRoutes } from "./internal-api-routes/admin-routes.js";

export * from "./internal-api-route-types.js";

export const InternalApiRoutes: readonly InternalApiRoute[] = [
  ...WorkspaceInternalApiRoutes,
  ...InboundInternalApiRoutes,
  ...OutboundInternalApiRoutes,
  ...JobsInternalApiRoutes,
  ...SchedulesInternalApiRoutes,
  ...SessionsInternalApiRoutes,
  ...AdminInternalApiRoutes
];
