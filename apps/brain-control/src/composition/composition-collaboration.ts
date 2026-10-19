import {
  AgentRunCancellationService,
  AgentRunCancellationFinalizer,
  DelegationService,
  DelegatedRunFactory,
  EffectiveRunPolicyResolver,
  PlannerDelegationService,
  PlannerDelegationGrantFactory,
  type ActionProposalService
} from "@second-brain/application";
import type { AgentCatalog, ClockPort, IdGeneratorPort } from "@second-brain/domain";
import { HttpRuntimeProvisionerClient } from "@second-brain/pi-adapter";
import type { readPlatformCatalogV2Artifact } from "@second-brain/platform-catalog";

import type { BrainControlRepositoryGraph } from "./composition-repositories.js";
import type { createWorkspaceComposition } from "./composition-workspaces.js";

export interface CollaborationCompositionOptions {
  repositories: Pick<BrainControlRepositoryGraph, "collaboration" | "jobs" | "pluginBindings">;
  loadedPlatformCatalog: Awaited<ReturnType<typeof readPlatformCatalogV2Artifact>> | undefined;
  runtimeProvisioner: ReturnType<typeof createWorkspaceComposition>["runtimeProvisioner"];
  agentCatalog: AgentCatalog;
  ids: IdGeneratorPort;
  clock: ClockPort;
  actionProposalService: ActionProposalService;
  effectiveRunPolicies?: Pick<EffectiveRunPolicyResolver, "resolve" | "resolveIfActive">;
}

/** Composes delegated-run policy, creation, and cancellation. */
export function createCollaborationComposition(options: CollaborationCompositionOptions) {
  const { collaboration, jobs, pluginBindings } = options.repositories;
  const effectiveRunPolicies =
    options.effectiveRunPolicies ??
    (options.loadedPlatformCatalog
      ? new EffectiveRunPolicyResolver(options.loadedPlatformCatalog, pluginBindings)
      : undefined);
  const plannerDelegation = new PlannerDelegationService(
    collaboration,
    new DelegationService(
      collaboration,
      jobs,
      new DelegatedRunFactory(options.agentCatalog, options.ids),
      options.clock
    ),
    new PlannerDelegationGrantFactory(options.agentCatalog, options.ids, options.clock)
  );
  const agentRunCancellation = options.runtimeProvisioner
    ? new AgentRunCancellationService(
        collaboration,
        {
          cancel: (run) =>
            new HttpRuntimeProvisionerClient(
              options.runtimeProvisioner!.baseUrl,
              options.runtimeProvisioner!.token
            ).cancel(run.workspaceId, run.id)
        },
        options.clock,
        new AgentRunCancellationFinalizer(options.clock, options.actionProposalService, jobs)
      )
    : undefined;
  return { effectiveRunPolicies, plannerDelegation, agentRunCancellation };
}
