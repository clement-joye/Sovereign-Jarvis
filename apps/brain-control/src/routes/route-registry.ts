import type { BrainControlDispatcher } from "./dispatcher.js";
import {
  registerAdminRoute,
  registerBrokerRoute,
  registerConversationRoute,
  registerExecutionRoute,
  registerInboundRoute,
  registerJobRoute,
  registerOutboundRoute,
  registerPlannerDelegationRoute,
  registerPluginBindingRoute,
  registerScheduleRoute,
  registerSessionRoute,
  registerWorkerCollaborationRoute,
  registerWorkspaceRoute
} from "./route-registrars.js";
import type { BrainControlRoute } from "./route-types.js";

/** Builds the ordered feature route chain; registration gates live with feature registrars. */
export function createBrainControlRouteRegistry(
  deps: BrainControlDispatcher
): readonly BrainControlRoute[] {
  const routes: BrainControlRoute[] = [];
  registerWorkerCollaborationRoute(routes, deps);
  registerPlannerDelegationRoute(routes, deps);
  registerWorkspaceRoute(routes, deps);
  registerInboundRoute(routes, deps);
  registerJobRoute(routes, deps);
  registerOutboundRoute(routes, deps);
  registerAdminRoute(routes, deps);
  registerPluginBindingRoute(routes, deps);
  registerBrokerRoute(routes, deps);
  registerScheduleRoute(routes, deps);
  registerExecutionRoute(routes, deps);
  registerConversationRoute(routes, deps);
  registerSessionRoute(routes, deps);
  return routes;
}
