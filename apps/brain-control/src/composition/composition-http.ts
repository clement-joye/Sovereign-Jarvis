import type { Server } from "node:http";

import { readJsonBody as readJson, writeJsonBody as writeJson } from "@second-brain/observability";
import { HttpRuntimeProvisionerClient } from "@second-brain/pi-adapter";

import type { createApprovalComposition } from "./composition-approvals.js";
import type { BrainControlBootstrap } from "./composition-bootstrap.js";
import type { createCollaborationComposition } from "./composition-collaboration.js";
import type { BrainControlRepositoryGraph } from "./composition-repositories.js";
import type { createSessionSchedulingComposition } from "./composition-session-scheduling.js";
import type { createWorkspaceComposition } from "./composition-workspaces.js";
import { createOutboundAndComplete } from "../outbound-completion.js";
import { createBrainControlHttpServer } from "../server.js";

export interface BrainControlHttpCompositionOptions {
  bootstrap: BrainControlBootstrap;
  repositories: BrainControlRepositoryGraph;
  approvals: ReturnType<typeof createApprovalComposition>;
  collaborationServices: ReturnType<typeof createCollaborationComposition>;
  sessionScheduling: ReturnType<typeof createSessionSchedulingComposition>;
  workspaces: ReturnType<typeof createWorkspaceComposition>;
}

/** Creates the HTTP host from already-composed capability graphs. */
export function createBrainControlServerFactory(
  options: BrainControlHttpCompositionOptions
): () => Server {
  return () =>
    createBrainControlHttpServer({
      logger: options.bootstrap.logger,
      dispatcher: createDispatcher(options)
    });
}

function createDispatcher(options: BrainControlHttpCompositionOptions) {
  const {
    bootstrap,
    repositories,
    approvals,
    collaborationServices,
    sessionScheduling,
    workspaces
  } = options;
  const { runtimeConfig, env } = bootstrap;
  return {
    serviceName: bootstrap.config.serviceName,
    version: "0.0.0",
    agentCatalog: bootstrap.agentCatalog,
    ...(bootstrap.catalogDigest ? { catalogDigest: bootstrap.catalogDigest } : {}),
    ...(bootstrap.policyDigest ? { policyDigest: bootstrap.policyDigest } : {}),
    postgresPool: bootstrap.postgresPool,
    inboundAcceptance: repositories.inboundAcceptance,
    inboundMessages: repositories.inboundMessages,
    ...(workspaces.runtimeProvisioner
      ? {
          cancelPiRun: (workspaceId: string, runId: string) =>
            new HttpRuntimeProvisionerClient(
              workspaces.runtimeProvisioner!.baseUrl,
              workspaces.runtimeProvisioner!.token
            ).cancel(workspaceId, runId)
        }
      : {}),
    jobs: repositories.jobs,
    rootAdmission: {
      limit: runtimeConfig.agentRootConcurrency,
      leaseMs: runtimeConfig.agentAdmissionLeaseSeconds * 1_000,
      heartbeatMs: runtimeConfig.agentAdmissionHeartbeatSeconds * 1_000
    },
    completeWithOutbound: createOutboundAndComplete({
      postgresPool: bootstrap.postgresPool,
      outbounds: repositories.outbounds,
      jobs: repositories.jobs
    }),
    outbounds: repositories.outbounds,
    outboundDelivery: repositories.outboundDelivery,
    scheduleAnchorBinder: sessionScheduling.scheduleAnchorBinder,
    scheduleService: sessionScheduling.scheduleService,
    scheduleApprovals: sessionScheduling.scheduleApprovals,
    sessions: repositories.sessions,
    retentionService: sessionScheduling.retentionService,
    executions: repositories.executions,
    ids: bootstrap.ids,
    sessionRouting: sessionScheduling.sessionRouting,
    preferences: repositories.preferences,
    workspaceResolution: workspaces.workspaceResolution,
    workspaceLifecycleResolution: workspaces.workspaceLifecycleResolution,
    workspaceRoomLifecycle: workspaces.workspaceRoomLifecycle,
    ...(workspaces.workspaceRoomRuntimeRecovery
      ? { workspaceRoomRuntimeRecovery: workspaces.workspaceRoomRuntimeRecovery }
      : {}),
    workspaceInvitation: workspaces.workspaceInvitation,
    roomLifecycleCommands: workspaces.roomLifecycleCommands,
    roomAgentCommands: workspaces.roomAgentCommands,
    roomPluginCommands: workspaces.roomPluginCommands,
    readJson,
    writeJson,
    ...(env.BRAIN_CONTROL_PI_SCHEDULE_TOKEN
      ? { scheduleToken: env.BRAIN_CONTROL_PI_SCHEDULE_TOKEN }
      : {}),
    ...(approvals.brokerOperations ? { brokerOperations: approvals.brokerOperations } : {}),
    ...(approvals.brokerOperations ? { approvalPrompts: approvals.approvalPrompts } : {}),
    pluginBindings: repositories.pluginBindings,
    actionApprovalPolicies: repositories.actionApprovalPolicies,
    pluginCatalog: bootstrap.pluginCatalog,
    collaboration: repositories.collaboration,
    workspaceWriteLeases: repositories.workspaceWriteLeases,
    ...(bootstrap.workerCollaborationToken
      ? { workerCollaborationToken: bootstrap.workerCollaborationToken }
      : {}),
    ...(bootstrap.runAuthorizations ? { runAuthorizations: bootstrap.runAuthorizations } : {}),
    ...(collaborationServices.effectiveRunPolicies
      ? { effectiveRunPolicies: collaborationServices.effectiveRunPolicies }
      : {}),
    plannerDelegation: collaborationServices.plannerDelegation,
    ...(collaborationServices.agentRunCancellation
      ? { agentRunCancellation: collaborationServices.agentRunCancellation }
      : {}),
    ...(env.BRAIN_CONTROL_PLUGIN_ADMIN_TOKEN
      ? { pluginAdminToken: env.BRAIN_CONTROL_PLUGIN_ADMIN_TOKEN }
      : {})
  };
}
