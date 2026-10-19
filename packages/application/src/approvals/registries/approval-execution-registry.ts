import type { ActionProposalConsumedV1, ActionProposalV1 } from "@second-brain/contracts";

import type { ActionProposalService } from "../commands/approval-service.js";

export type ApprovedActionExecutor = (proposal: ActionProposalV1) => Promise<unknown>;

/** A provider-vetted execution reason that is safe to present to the workspace owner. */
export class ApprovedActionExecutionError extends Error {
  constructor(readonly publicReason: string) {
    super(publicReason);
    this.name = "ApprovedActionExecutionError";
  }
}

/**
 * Generic continuation boundary for approved operations. Providers register a
 * reviewed operation handler; Matrix and other transports only name a durable
 * proposal and never supply executable parameters.
 */
export class ApprovalExecutionRegistry {
  private readonly executors = new Map<string, ApprovedActionExecutor>();

  constructor(
    private readonly proposals: Pick<ActionProposalService, "getProposal" | "consumeAndExecute">
  ) {}

  register(input: {
    pluginId: string;
    operationId: string;
    execute: ApprovedActionExecutor;
  }): void {
    const key = operationKey(input.pluginId, input.operationId);
    if (this.executors.has(key)) {
      throw new Error(`Duplicate approved action executor: ${key}.`);
    }
    this.executors.set(key, input.execute);
  }

  async executeApproved(proposalId: string): Promise<ActionProposalConsumedV1> {
    const proposal = await this.proposals.getProposal(proposalId);
    if (!proposal) throw new Error("Action proposal was not found.");
    const execute = this.executors.get(operationKey(proposal.pluginId, proposal.operationId));
    if (!execute) {
      throw new Error(
        `No approved action executor is registered for ${proposal.pluginId}/${proposal.operationId}.`
      );
    }
    return this.proposals.consumeAndExecute(
      {
        proposalId: proposal.id,
        workspaceId: proposal.workspaceId,
        agentId: proposal.agentId,
        runId: proposal.runId,
        pluginId: proposal.pluginId,
        capabilityId: proposal.capabilityId,
        operationId: proposal.operationId,
        operationVersion: proposal.operationVersion,
        operationDigest: proposal.operationDigest,
        idempotencyKey: proposal.idempotencyKey
      },
      execute
    );
  }
}

function operationKey(pluginId: string, operationId: string): string {
  return `${pluginId}:${operationId}`;
}
