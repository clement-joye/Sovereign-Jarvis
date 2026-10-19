import type {
  ActionApprovalDecisionV1,
  ActionProposalV1,
  ApprovalModeV1
} from "@second-brain/contracts";

export interface ActionProposalRepositoryPort {
  createIfAbsent(
    input: ActionProposalV1
  ): Promise<{ proposal: ActionProposalV1; created: boolean }>;
  get(id: string): Promise<ActionProposalV1 | undefined>;
  bindPrompt(input: {
    proposalId: string;
    workspaceId: string;
    outboundMessageId: string;
  }): Promise<void>;
  getByPromptExternalEvent(input: {
    workspaceId: string;
    externalEventId: string;
  }): Promise<ActionProposalV1 | undefined>;
  forwardDecision(input: ActionApprovalDecisionV1): Promise<ActionProposalV1 | undefined>;
  markExpired(input: { proposalId: string; now: Date }): Promise<ActionProposalV1 | undefined>;
  cancelForRun(input: {
    workspaceId: string;
    runId: string;
    now: Date;
  }): Promise<ActionProposalV1[]>;
  consume(input: {
    proposalId: string;
    workspaceId: string;
    agentId: string;
    runId: string;
    pluginId: string;
    capabilityId: string;
    operationId: string;
    operationVersion: string;
    operationDigest: string;
    idempotencyKey: string;
    now: Date;
  }): Promise<ActionProposalV1 | undefined>;
}

export interface ActionApprovalPolicyRepositoryPort {
  getMode(
    workspaceId: string,
    pluginId: string,
    operationId: string
  ): Promise<ApprovalModeV1 | undefined>;
  replaceOwnerRequiredOperations(input: {
    workspaceId: string;
    pluginId: string;
    operationIds: readonly string[];
    updatedAt: Date;
  }): Promise<void>;
}
