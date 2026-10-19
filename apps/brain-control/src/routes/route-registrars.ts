import type { BrainControlDispatcher } from "./dispatcher.js";
import { handleAdminRoute } from "./admin-routes.js";
import { handleBrokerRoute } from "./broker-routes.js";
import { handleConversationRoute } from "./conversation-routes.js";
import { handleExecutionRoute } from "./execution-routes.js";
import { handleInboundRoute } from "./inbound-routes.js";
import { handleJobRoute } from "./job-routes.js";
import { handleOutboundRoute } from "./outbound-routes.js";
import { handlePlannerDelegationRoute } from "./planner-delegation-routes.js";
import { handlePluginBindingRoute } from "./plugin-binding-routes.js";
import { handleScheduleRoute } from "./schedule-routes.js";
import { handleSessionRoute } from "./session-routes.js";
import { handleWorkerCollaborationRoute } from "./worker-collaboration-routes.js";
import { handleWorkspaceRoute } from "./workspace-routes.js";
import type { BrainControlRoute } from "./route-types.js";

type Routes = BrainControlRoute[];
type Ctx = {
  request: Parameters<BrainControlRoute>[0]["request"];
  response: Parameters<BrainControlRoute>[0]["response"];
  url: URL;
};
const add = (routes: Routes, fn: (ctx: Ctx) => Promise<boolean>) => routes.push(fn);

export function registerWorkerCollaborationRoute(r: Routes, d: BrainControlDispatcher): void {
  if (!d.collaboration || !d.workspaceWriteLeases) return;
  add(r, ({ request, response, url }) =>
    handleWorkerCollaborationRoute(request, response, url, {
      runs: d.collaboration!,
      leases: d.workspaceWriteLeases!,
      ...(d.workerCollaborationToken ? { token: d.workerCollaborationToken } : {}),
      ...(d.runAuthorizations ? { runAuthorizations: d.runAuthorizations } : {}),
      readJson: d.readJson,
      writeJson: d.writeJson
    })
  );
}
export function registerPlannerDelegationRoute(r: Routes, d: BrainControlDispatcher): void {
  if (!d.collaboration || !d.plannerDelegation) return;
  add(r, ({ request, response, url }) =>
    handlePlannerDelegationRoute(request, response, url, {
      runs: d.collaboration!,
      planner: d.plannerDelegation!,
      ...(d.agentRunCancellation ? { cancellation: d.agentRunCancellation } : {}),
      ...(d.effectiveRunPolicies ? { effectiveRunPolicies: d.effectiveRunPolicies } : {}),
      ...(d.runAuthorizations ? { runAuthorizations: d.runAuthorizations } : {}),
      outbounds: d.outbounds,
      jobs: d.jobs,
      readJson: d.readJson,
      writeJson: d.writeJson
    })
  );
}
export function registerWorkspaceRoute(r: Routes, d: BrainControlDispatcher): void {
  if (!d.workspaceResolution || !d.workspaceInvitation) return;
  add(r, ({ request, response, url }) =>
    handleWorkspaceRoute(request, response, url, {
      workspaceResolution: d.workspaceResolution!,
      workspaceInvitation: d.workspaceInvitation!,
      defaultAgentId: d.agentCatalog.defaultAgentId(),
      outbounds: d.outbounds,
      readJson: d.readJson,
      writeJson: d.writeJson,
      ...(d.workspaceLifecycleResolution
        ? { workspaceLifecycleResolution: d.workspaceLifecycleResolution }
        : {}),
      ...(d.workspaceRoomLifecycle ? { workspaceRoomLifecycle: d.workspaceRoomLifecycle } : {}),
      ...(d.workspaceRoomRuntimeRecovery
        ? { workspaceRoomRuntimeRecovery: d.workspaceRoomRuntimeRecovery }
        : {}),
      ...(d.roomLifecycleCommands ? { roomLifecycleCommands: d.roomLifecycleCommands } : {}),
      ...(d.roomAgentCommands ? { roomAgentCommands: d.roomAgentCommands } : {}),
      ...(d.roomPluginCommands ? { roomPluginCommands: d.roomPluginCommands } : {})
    })
  );
}
export function registerInboundRoute(r: Routes, d: BrainControlDispatcher): void {
  add(r, ({ request, response, url }) =>
    handleInboundRoute(request, response, url, {
      inboundAcceptance: d.inboundAcceptance,
      inboundMessages: d.inboundMessages,
      agentCatalog: d.agentCatalog,
      ...(d.cancelPiRun ? { cancelPiRun: d.cancelPiRun } : {}),
      ...(d.workspaceResolution ? { workspaceResolution: d.workspaceResolution } : {}),
      readJson: d.readJson,
      writeJson: d.writeJson
    })
  );
}
export function registerJobRoute(r: Routes, d: BrainControlDispatcher): void {
  add(r, ({ request, response, url }) =>
    handleJobRoute(request, response, url, {
      jobs: d.jobs,
      ...(d.rootAdmission ? { rootAdmission: d.rootAdmission } : {}),
      completeWithOutbound: d.completeWithOutbound,
      agentCatalog: d.agentCatalog,
      ...(d.collaboration ? { runs: d.collaboration } : {}),
      ...(d.runAuthorizations ? { runAuthorizations: d.runAuthorizations } : {}),
      ...(d.effectiveRunPolicies ? { effectiveRunPolicies: d.effectiveRunPolicies } : {}),
      readJson: d.readJson,
      writeJson: d.writeJson
    })
  );
}
export function registerOutboundRoute(r: Routes, d: BrainControlDispatcher): void {
  add(r, ({ request, response, url }) =>
    handleOutboundRoute(request, response, url, {
      outbounds: d.outbounds,
      outboundDelivery: d.outboundDelivery,
      scheduleAnchorBinder: d.scheduleAnchorBinder,
      readJson: d.readJson,
      writeJson: d.writeJson
    })
  );
}
export function registerAdminRoute(r: Routes, d: BrainControlDispatcher): void {
  add(r, ({ request, response, url }) =>
    handleAdminRoute(request, response, url, {
      jobs: d.jobs,
      ...(d.rootAdmission ? { rootAdmissionLimit: d.rootAdmission.limit } : {}),
      scheduleService: d.scheduleService,
      sessions: d.sessions,
      retentionService: d.retentionService,
      readJson: d.readJson,
      writeJson: d.writeJson
    })
  );
}
export function registerPluginBindingRoute(r: Routes, d: BrainControlDispatcher): void {
  if (!d.pluginBindings || !d.pluginCatalog) return;
  add(r, ({ request, response, url }) =>
    handlePluginBindingRoute(request, response, url, {
      bindings: d.pluginBindings!,
      catalog: d.pluginCatalog!,
      ...(d.actionApprovalPolicies ? { approvalPolicies: d.actionApprovalPolicies } : {}),
      ...(d.pluginAdminToken ? { adminToken: d.pluginAdminToken } : {}),
      readJson: d.readJson,
      writeJson: d.writeJson,
      now: () => new Date()
    })
  );
}
export function registerBrokerRoute(r: Routes, d: BrainControlDispatcher): void {
  if (!d.brokerOperations || !d.runAuthorizations || !d.approvalPrompts) return;
  add(r, ({ request, response, url }) =>
    handleBrokerRoute(request, response, url, {
      operations: d.brokerOperations!,
      runAuthorizations: d.runAuthorizations!,
      approvalPrompts: d.approvalPrompts!,
      readJson: d.readJson,
      writeJson: d.writeJson
    })
  );
}
export function registerScheduleRoute(r: Routes, d: BrainControlDispatcher): void {
  add(r, ({ request, response, url }) =>
    handleScheduleRoute(request, response, url, {
      scheduleService: d.scheduleService,
      ...(d.scheduleApprovals ? { scheduleApprovals: d.scheduleApprovals } : {}),
      ...(d.approvalPrompts ? { approvalPrompts: d.approvalPrompts } : {}),
      ids: d.ids,
      readJson: d.readJson,
      writeJson: d.writeJson,
      ...(d.scheduleToken ? { scheduleToken: d.scheduleToken } : {}),
      ...(d.runAuthorizations ? { runAuthorizations: d.runAuthorizations } : {})
    })
  );
}
export function registerExecutionRoute(r: Routes, d: BrainControlDispatcher): void {
  add(r, ({ request, response, url }) =>
    handleExecutionRoute(request, response, url, {
      executions: d.executions,
      readJson: d.readJson,
      writeJson: d.writeJson
    })
  );
}
export function registerConversationRoute(r: Routes, d: BrainControlDispatcher): void {
  add(r, ({ request, response, url }) =>
    handleConversationRoute(request, response, url, {
      sessionRouting: d.sessionRouting,
      preferences: d.preferences,
      readJson: d.readJson,
      writeJson: d.writeJson
    })
  );
}
export function registerSessionRoute(r: Routes, d: BrainControlDispatcher): void {
  add(r, ({ request, response, url }) =>
    handleSessionRoute(request, response, url, {
      sessions: d.sessions,
      readJson: d.readJson,
      writeJson: d.writeJson
    })
  );
}
