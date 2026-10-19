import type { Server } from "node:http";
// Runtime composition is intentionally isolated from the executable entrypoint.

import type { EffectiveRunPolicyResolver, RoomPluginCatalog } from "@second-brain/application";
import type { AgentCatalog } from "@second-brain/domain";
import type { StructuredLogger } from "@second-brain/observability";

import type { BrainControlStorageMode } from "../storage/storage-mode.js";
import { createBrainControlBootstrap } from "./composition-bootstrap.js";
import { createBrainControlRepositoryGraph } from "./composition-repositories.js";
import { createApprovalComposition } from "./composition-approvals.js";
import { createWorkspaceComposition } from "./composition-workspaces.js";
import { createSessionSchedulingComposition } from "./composition-session-scheduling.js";
import { createCollaborationComposition } from "./composition-collaboration.js";
import { createBrainControlServerFactory } from "./composition-http.js";

export interface BrainControlCompositionOptions {
  readonly env?: NodeJS.ProcessEnv;
  /** Explicit test/development fixture used only when no release artifact is configured. */
  readonly agentCatalog?: AgentCatalog;
  /** Explicit plugin-management fixture used only when no release artifact is configured. */
  readonly pluginCatalog?: RoomPluginCatalog;
  readonly catalogDigest?: string;
  readonly policyDigest?: string;
  readonly workerCollaborationToken?: string;
  readonly runAuthorizationSecret?: string;
  /** Explicit test fixture used when no reviewed platform artifact is configured. */
  readonly effectiveRunPolicies?: Pick<EffectiveRunPolicyResolver, "resolve" | "resolveIfActive">;
}

export interface BrainControlComposition {
  readonly createServer: () => Server;
  readonly logger: StructuredLogger;
  readonly port: number;
  readonly storageMode: BrainControlStorageMode;
  readonly catalogDigest: string | undefined;
  readonly policyDigest: string | undefined;
}

export async function createBrainControlComposition(
  options: BrainControlCompositionOptions = {}
): Promise<BrainControlComposition> {
  const bootstrap = await createBrainControlBootstrap(options);
  const {
    env,
    runtimeConfig,
    logger,
    securityEvents,
    storageMode,
    loadedPlatformCatalog,
    catalogDigest,
    policyDigest,
    agentCatalog,
    pluginCatalog,
    postgresPool,
    ids
  } = bootstrap;
  const repositories = createBrainControlRepositoryGraph({
    postgresPool,
    ids,
    retentionMs: runtimeConfig.retentionMs,
    maxRetentionMs: runtimeConfig.maxRetentionMs
  });
  const {
    jobs,
    collaboration,
    inboundMessages,
    workspaces,
    schedules,
    pluginBindings,
    actionApprovalPolicies,
    actionProposals,
    outbounds
  } = repositories;
  const clock = { now: () => new Date() };
  const workspaceComposition = createWorkspaceComposition({
    env,
    workspaces,
    schedules,
    outbounds,
    pluginBindings,
    ids,
    clock,
    agentCatalog,
    pluginCatalog
  });
  const { runtimeProvisioner } = workspaceComposition;
  const approvalComposition = createApprovalComposition({
    loadedPlatformCatalog,
    proposals: actionProposals,
    ids,
    clock,
    policies: actionApprovalPolicies,
    securityEvents,
    pluginBindings,
    ...(runtimeProvisioner ? { privilegedBroker: runtimeProvisioner } : {}),
    logger,
    prompt: {
      jobs,
      inbound: inboundMessages,
      outbounds,
      ids,
      schedules,
      runs: collaboration
    }
  });
  const { reviewedOperations, actionProposalService, approvalExecutions, approvalCommands } =
    approvalComposition;
  const collaborationServices = createCollaborationComposition({
    repositories,
    loadedPlatformCatalog,
    runtimeProvisioner,
    agentCatalog,
    ids,
    clock,
    actionProposalService,
    ...(options.effectiveRunPolicies ? { effectiveRunPolicies: options.effectiveRunPolicies } : {})
  });

  const sessionScheduling = createSessionSchedulingComposition({
    repositories,
    clock,
    ids,
    agentCatalog,
    approvalCommands,
    actionProposalService,
    approvalExecutions,
    reviewedOperations,
    config: {
      sessionIdleContinuationMs: runtimeConfig.sessionIdleContinuationMs,
      sessionRetentionMs: runtimeConfig.sessionRetentionMs,
      scheduleDisplayTimezone: runtimeConfig.scheduleDisplayTimezone
    }
  });
  return {
    createServer: createBrainControlServerFactory({
      bootstrap,
      repositories,
      approvals: approvalComposition,
      collaborationServices,
      sessionScheduling,
      workspaces: workspaceComposition
    }),
    logger,
    port: runtimeConfig.port,
    storageMode,
    catalogDigest,
    policyDigest
  };
}
