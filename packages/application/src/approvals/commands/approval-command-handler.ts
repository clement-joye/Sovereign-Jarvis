import type { InboundMessageV1 } from "@second-brain/contracts";

import {
  ActionProposalConflictError,
  ActionProposalExpiredError,
  ActionProposalValidationError,
  type ActionProposalService
} from "./approval-service.js";
import type { ApprovalExecutionRegistry } from "../registries/approval-execution-registry.js";
import { ApprovedActionExecutionError } from "../registries/approval-execution-registry.js";
import { approvedActionResult } from "./approved-action-result.js";

export interface ApprovalExecutionFailure {
  proposalId: string;
  workspaceId: string;
  pluginId: string;
  operationId: string;
  error: unknown;
}

export interface ApprovalCommand {
  type: "approve" | "reject" | "approve-reply" | "reject-reply";
  proposalId?: string;
}

/** Applies an owner-authenticated Matrix decision without involving a model. */
export class ApprovalCommandHandler {
  constructor(
    private readonly proposals: Pick<ActionProposalService, "decide" | "getProposalForPromptReply">,
    private readonly executions: Pick<ApprovalExecutionRegistry, "executeApproved">,
    private readonly clock: { now(): Date },
    private readonly reportExecutionFailure?: (failure: ApprovalExecutionFailure) => void
  ) {}

  async handle(message: InboundMessageV1, command: ApprovalCommand): Promise<string> {
    if (!message.workspaceId) {
      return "**Approval rejected**\n\nThis room is not bound to a workspace.";
    }
    const resolved = await this.resolveCommand(message, command);
    if (typeof resolved === "string") return resolved;
    const { proposalId, decision } = resolved;
    let proposal;
    try {
      proposal = await this.proposals.decide({
        schemaVersion: 1,
        proposalId,
        workspaceId: message.workspaceId,
        ownerId: message.senderId,
        decision,
        decidedBy: "owner",
        decidedAt: this.clock.now().toISOString(),
        externalEventId: message.externalEventId
      });
    } catch (error) {
      const response = decisionFailure(proposalId, error);
      if (response) return response;
      throw error;
    }
    if (decision === "reject") {
      return `**Action rejected**\n\nProposal \`${proposal.id}\` will not run.`;
    }

    try {
      const outcome = await this.executions.executeApproved(proposal.id);
      return approvedActionResult(proposal, outcome.result);
    } catch (error) {
      this.reportExecutionFailure?.({
        proposalId: proposal.id,
        workspaceId: proposal.workspaceId,
        pluginId: proposal.pluginId,
        operationId: proposal.operationId,
        error
      });
      // Consumption happens before execution. Never invite a blind retry when
      // the external outcome may be ambiguous.
      return [
        "**Approved action did not complete**",
        "",
        `Proposal: \`${proposal.id}\``,
        ...(error instanceof ApprovedActionExecutionError
          ? ["", `Reason: ${error.publicReason}`]
          : []),
        "",
        "The action was not completed, or its outcome is uncertain. Jarvis will not retry it automatically. Inspect the target before proposing it again."
      ].join("\n");
    }
  }

  private async resolveCommand(
    message: InboundMessageV1,
    command: ApprovalCommand
  ): Promise<{ proposalId: string; decision: "approve" | "reject" } | string> {
    if (command.type === "approve" || command.type === "reject") {
      if (!command.proposalId) return "**Approval not applied**\n\nThe proposal ID is missing.";
      return { proposalId: command.proposalId, decision: command.type };
    }
    if (!message.replyToExternalEventId) {
      return [
        "**Approval not applied**",
        "",
        "Reply directly to an approval request with `/yes` or `/no`."
      ].join("\n");
    }
    const proposal = await this.proposals.getProposalForPromptReply({
      workspaceId: message.workspaceId!,
      externalEventId: message.replyToExternalEventId
    });
    if (!proposal) {
      return [
        "**Approval not applied**",
        "",
        "The replied-to message is not an approval request for this workspace.",
        "Use Reply on the **Jarvis · Approval required** message itself, then send `/yes` or `/no`. A reply to the agent's follow-up does not approve it."
      ].join("\n");
    }
    return {
      proposalId: proposal.id,
      decision: command.type === "approve-reply" ? "approve" : "reject"
    };
  }
}

function decisionFailure(proposalId: string, error: unknown): string | undefined {
  if (error instanceof ActionProposalExpiredError) {
    return [
      "**Approval expired**",
      "",
      `Proposal \`${proposalId}\` has expired and cannot be executed.`,
      "Submit the original request again and approve the new proposal."
    ].join("\n");
  }
  if (error instanceof ActionProposalConflictError) {
    return [
      "**Approval not applied**",
      "",
      "The proposal was not found, was already decided, or does not belong to this workspace."
    ].join("\n");
  }
  if (error instanceof ActionProposalValidationError) {
    return "**Approval not applied**\n\nThe decision is not valid for this proposal.";
  }
  return undefined;
}
