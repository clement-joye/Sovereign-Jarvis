import {
  ActionApprovalDecisionV1Schema,
  ActionProposalConsumedV1Schema,
  ActionProposalCreateRequestV1Schema,
  type ActionApprovalDecisionV1,
  type ActionProposalConsumedV1,
  type ActionProposalCreateRequestV1,
  type ActionProposalV1,
  type ApprovalModeV1
} from "@second-brain/contracts";
import type { ClockPort, IdGeneratorPort } from "@second-brain/domain";
import { emitSecurityEvent, type SecurityEventEmitter } from "@second-brain/observability";

import type {
  ActionApprovalPolicyRepositoryPort,
  ActionProposalRepositoryPort
} from "../../ports.js";
import type {
  ActionProposalConsumeInput,
  ActionProposalCreateOptions,
  ActionProposalServiceDependencies
} from "../proposals/action-proposal-types.js";
import { actionProposalOperationDigest } from "../proposals/action-proposal-canonicalization.js";
import {
  assertConsumeBinding,
  assertSameProposalBinding
} from "../proposals/action-proposal-binding.js";
import {
  ActionProposalConflictError,
  ActionProposalExpiredError,
  ActionProposalPendingError,
  ActionProposalValidationError
} from "../proposals/action-proposal-errors.js";

export {
  canonicalJson,
  canonicalizeActionProposalOperation,
  actionProposalOperationDigest
} from "../proposals/action-proposal-canonicalization.js";
export {
  ActionProposalConflictError,
  ActionProposalExpiredError,
  ActionProposalPendingError,
  ActionProposalValidationError
} from "../proposals/action-proposal-errors.js";
export type {
  ActionProposalConsumeInput,
  ActionProposalCreateOptions,
  ActionProposalServiceDependencies
} from "../proposals/action-proposal-types.js";

export const ACTION_PROPOSAL_LIFETIME_MS = 24 * 60 * 60 * 1_000;

/**
 * Reusable application-layer middleware for owner approval of arbitrary tool
 * operations. It deliberately knows nothing about Git, Matrix, or a concrete
 * plugin: those adapters provide the durable repository and trusted decision
 * forwarding boundary.
 */
export class ActionProposalService {
  private readonly proposals: ActionProposalRepositoryPort;
  private readonly ids: IdGeneratorPort;
  private readonly clock: ClockPort;
  private readonly policies: Pick<ActionApprovalPolicyRepositoryPort, "getMode"> | undefined;
  private readonly securityEvents: SecurityEventEmitter | undefined;

  constructor(dependencies: ActionProposalServiceDependencies) {
    this.proposals = dependencies.proposals;
    this.ids = dependencies.ids;
    this.clock = dependencies.clock;
    this.policies = dependencies.policies;
    this.securityEvents = dependencies.securityEvents;
  }

  /**
   * Creates (or idempotently returns) a proposal. `approvalMode` in the
   * request is treated as the caller's requested/user policy and is raised to
   * the reviewed operation minimum when necessary.
   */
  async createProposal(
    input: ActionProposalCreateRequestV1,
    options: ActionProposalCreateOptions = {}
  ): Promise<ActionProposalV1> {
    const request = ActionProposalCreateRequestV1Schema.parse(input);
    const expectedDigest = actionProposalOperationDigest(request);
    if (request.operationDigest !== expectedDigest) {
      throw new ActionProposalValidationError(
        "Action proposal operation digest does not match its canonical operation and parameters."
      );
    }

    const now = this.clock.now();
    // Proposal lifetime is platform policy. Callers retain an expiry field for
    // wire compatibility, but cannot shorten or extend the authorization.
    const expiresAt = new Date(now.getTime() + ACTION_PROPOSAL_LIFETIME_MS).toISOString();

    const configuredMode = await this.policies?.getMode(
      request.workspaceId,
      request.pluginId,
      request.operation.operationId
    );
    const approvalMode = strongestApprovalMode(
      request.operation.approvalPolicy.minimumMode,
      request.approvalMode,
      configuredMode,
      options.approvalModeOverride
    );
    const proposal = {
      schemaVersion: 1 as const,
      id: this.ids.nextId("action-proposal"),
      operationDigest: request.operationDigest,
      workspaceId: request.workspaceId,
      agentId: request.agentId,
      runId: request.runId,
      pluginId: request.pluginId,
      capabilityId: request.operation.capabilityId,
      operationId: request.operation.operationId,
      operationVersion: request.operation.operationVersion,
      summary: request.summary,
      parameters: request.parameters,
      approvalMode,
      requiredApprover: approvalMode === "owner" ? ("owner" as const) : ("none" as const),
      idempotencyKey: request.idempotencyKey,
      status: approvalMode === "owner" ? ("proposed" as const) : ("approved" as const),
      createdAt: now.toISOString(),
      expiresAt
    } satisfies ActionProposalV1;

    const stored = await this.proposals.createIfAbsent(proposal);
    if (!stored.created) assertSameProposalBinding(proposal, stored.proposal);
    return stored.proposal;
  }

  /**
   * Forwards only a schema-valid owner decision to the durable repository.
   * Transport adapters should call this after authenticating the owner event;
   * model output must never be routed here as if it were a trusted event.
   */
  async forwardTrustedDecision(input: ActionApprovalDecisionV1): Promise<ActionProposalV1> {
    const decision = ActionApprovalDecisionV1Schema.parse(input);
    const proposal = await this.proposals.get(decision.proposalId);
    if (!proposal) throw new ActionProposalConflictError("Action proposal was not found.");
    if (proposal.workspaceId !== decision.workspaceId) {
      throw new ActionProposalConflictError("Action proposal belongs to a different workspace.");
    }
    const current = await this.expireIfNeeded(proposal);
    if (current.status === "expired") {
      throw new ActionProposalExpiredError("Action proposal has expired.");
    }
    if (current.status !== "proposed") {
      throw new ActionProposalConflictError(
        `Action proposal cannot receive a decision while ${current.status}.`
      );
    }
    if (current.approvalMode !== "owner" || current.requiredApprover !== "owner") {
      throw new ActionProposalValidationError("Action proposal does not require owner approval.");
    }
    const decidedAt = timestamp(decision.decidedAt, "decidedAt");
    if (decidedAt < new Date(current.createdAt).getTime()) {
      throw new ActionProposalValidationError("Action decision cannot predate its proposal.");
    }
    if (decidedAt >= new Date(current.expiresAt).getTime()) {
      throw new ActionProposalExpiredError("Action proposal has expired.");
    }
    const updated = await this.proposals.forwardDecision(decision);
    if (!updated)
      throw new ActionProposalConflictError("Action proposal decision was not applied.");
    return updated;
  }

  /** Short alias for transport adapters that expose an approval decision API. */
  async decide(input: ActionApprovalDecisionV1): Promise<ActionProposalV1> {
    return this.forwardTrustedDecision(input);
  }

  /** Reads a proposal and durably marks it expired when its deadline passed. */
  async getProposal(proposalId: string): Promise<ActionProposalV1 | undefined> {
    const proposal = await this.proposals.get(proposalId);
    return proposal ? this.expireIfNeeded(proposal) : undefined;
  }

  /** Resolves only a proposal whose dedicated prompt was the replied-to Matrix event. */
  async getProposalForPromptReply(input: {
    workspaceId: string;
    externalEventId: string;
  }): Promise<ActionProposalV1 | undefined> {
    const proposal = await this.proposals.getByPromptExternalEvent(input);
    return proposal ? this.expireIfNeeded(proposal) : undefined;
  }

  /** Links a proposal to the durable outbound carrying its approval prompt. */
  bindPrompt(input: {
    proposalId: string;
    workspaceId: string;
    outboundMessageId: string;
  }): Promise<void> {
    return this.proposals.bindPrompt(input);
  }

  /** Revokes all outstanding approvals belonging to a cancelled run. */
  async cancelForRun(input: {
    workspaceId: string;
    runId: string;
    now?: Date;
  }): Promise<ActionProposalV1[]> {
    return this.proposals.cancelForRun({
      workspaceId: input.workspaceId,
      runId: input.runId,
      now: input.now ?? this.clock.now()
    });
  }

  /**
   * Atomically consumes exactly one approved operation. The repository must
   * repeat every binding check and the one-time state transition in one
   * transaction; `undefined` is never interpreted as permission to execute.
   */
  async consumeAndExecute<Result>(
    input: ActionProposalConsumeInput,
    execute: (proposal: ActionProposalV1) => Promise<Result>
  ): Promise<ActionProposalConsumedV1> {
    const proposal = await this.proposals.get(input.proposalId);
    if (!proposal) throw new ActionProposalConflictError("Action proposal was not found.");
    const current = await this.expireIfNeeded(proposal);
    if (current.status === "expired") {
      throw new ActionProposalExpiredError("Action proposal has expired.");
    }
    if (current.status === "proposed") {
      throw new ActionProposalPendingError("Action proposal is awaiting owner approval.");
    }
    if (current.status !== "approved") {
      throw new ActionProposalConflictError(
        `Action proposal cannot be consumed while ${current.status}.`
      );
    }
    assertConsumeBinding(current, input);
    const consumed = await this.proposals.consume({ ...input, now: this.clock.now() });
    if (!consumed) {
      throw new ActionProposalConflictError(
        "Action proposal was already consumed or no longer matches the exact operation."
      );
    }
    emitSecurityEvent(this.securityEvents, {
      type: "approval.consumed",
      reason: "approved_operation_consumed",
      workspaceId: consumed.workspaceId,
      runId: consumed.runId,
      agentId: consumed.agentId,
      pluginId: consumed.pluginId,
      operationId: consumed.operationId
    });
    // Authorization is consumed before the external callback. A crash between
    // these two steps loses the action instead of risking an automatic replay.
    const result = await execute(consumed);
    return ActionProposalConsumedV1Schema.parse({
      schemaVersion: 1,
      proposalId: consumed.id,
      outcome: "consumed",
      result
    });
  }

  private async expireIfNeeded(proposal: ActionProposalV1): Promise<ActionProposalV1> {
    const now = this.clock.now();
    if (
      (proposal.status === "proposed" || proposal.status === "approved") &&
      timestamp(proposal.expiresAt, "expiresAt") <= now.getTime()
    ) {
      return (
        (await this.proposals.markExpired({ proposalId: proposal.id, now })) ?? {
          ...proposal,
          status: "expired"
        }
      );
    }
    return proposal;
  }
}

function strongestApprovalMode(...modes: Array<ApprovalModeV1 | undefined>): ApprovalModeV1 {
  return modes.some((mode) => mode === "owner") ? "owner" : "none";
}

function timestamp(value: string, name: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new ActionProposalValidationError(`Action proposal ${name} must be a valid timestamp.`);
  }
  return parsed;
}
