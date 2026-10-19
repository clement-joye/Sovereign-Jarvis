import {
  ActionProposalService,
  type ActionProposalServiceDependencies,
  ApprovalCommandHandler,
  ApprovalExecutionRegistry,
  BrokerOperationRegistry,
  ReviewedActionOperationRegistry
} from "@second-brain/application";
import { createInstalledBrokerHandlers } from "@second-brain/installed-plugins";
import type { StructuredLogger } from "@second-brain/observability";
import type { readPlatformCatalogV2Artifact } from "@second-brain/platform-catalog";

import {
  ApprovalPromptPublisher,
  type ApprovalPromptPublisherOptions
} from "../approvals/approval-prompt-publisher.js";

type BrokerHandlerOptions = Parameters<typeof createInstalledBrokerHandlers>[0];

export interface ApprovalCompositionOptions {
  loadedPlatformCatalog: Awaited<ReturnType<typeof readPlatformCatalogV2Artifact>> | undefined;
  proposals: ActionProposalServiceDependencies["proposals"];
  ids: ActionProposalServiceDependencies["ids"];
  clock: ActionProposalServiceDependencies["clock"];
  policies: NonNullable<ActionProposalServiceDependencies["policies"]>;
  securityEvents: NonNullable<ActionProposalServiceDependencies["securityEvents"]>;
  pluginBindings: BrokerHandlerOptions["bindings"];
  privilegedBroker?: BrokerHandlerOptions["privilegedBroker"];
  logger: StructuredLogger;
  prompt: Omit<ApprovalPromptPublisherOptions, "proposals">;
}

/** Composes the reviewed-action approval and broker control-plane capability. */
export function createApprovalComposition(options: ApprovalCompositionOptions) {
  const reviewedOperations = options.loadedPlatformCatalog
    ? new ReviewedActionOperationRegistry(options.loadedPlatformCatalog)
    : undefined;
  const actionProposalService = new ActionProposalService({
    proposals: options.proposals,
    ids: options.ids,
    clock: options.clock,
    policies: options.policies,
    securityEvents: options.securityEvents
  });
  const approvalExecutions = new ApprovalExecutionRegistry(actionProposalService);
  const brokerHandlers = reviewedOperations
    ? createInstalledBrokerHandlers({
        bindings: options.pluginBindings,
        proposals: actionProposalService,
        operations: reviewedOperations,
        ...(options.privilegedBroker ? { privilegedBroker: options.privilegedBroker } : {})
      })
    : [];
  const brokerOperations = options.loadedPlatformCatalog
    ? new BrokerOperationRegistry(options.loadedPlatformCatalog.catalog, brokerHandlers)
    : undefined;
  brokerOperations?.registerApprovalExecutors(approvalExecutions);
  const approvalCommands = new ApprovalCommandHandler(
    actionProposalService,
    approvalExecutions,
    options.clock,
    (failure) => reportExecutionFailure(options.logger, failure)
  );
  options.logger.info("Plugin broker configuration", {
    registeredHandlers: brokerHandlers.map(({ implementationId }) => implementationId)
  });
  const approvalPrompts = new ApprovalPromptPublisher({
    ...options.prompt,
    proposals: actionProposalService
  });
  return {
    reviewedOperations,
    actionProposalService,
    approvalExecutions,
    brokerOperations,
    approvalCommands,
    approvalPrompts
  };
}

function reportExecutionFailure(
  logger: StructuredLogger,
  failure: Parameters<NonNullable<ConstructorParameters<typeof ApprovalCommandHandler>[3]>>[0]
): void {
  logger.error("Approved action execution failed", {
    proposal_id: failure.proposalId,
    workspace_id: failure.workspaceId,
    plugin_id: failure.pluginId,
    operation_id: failure.operationId,
    error: failure.error instanceof Error ? failure.error.message : String(failure.error),
    stack: failure.error instanceof Error ? failure.error.stack : undefined
  });
}
