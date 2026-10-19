import { describe, expect, it, vi } from "vitest";
import type { ActionApprovalDecisionV1, ActionProposalV1 } from "@second-brain/contracts";
import type { ActionProposalRepositoryPort } from "@second-brain/application/ports";
import { ActionProposalService, ApprovalExecutionRegistry } from "@second-brain/application";
import { ApprovalCommandHandler } from "@second-brain/application";

import { BrowserActionService } from "./browser-control.js";

const reviewedOperation = {
  capabilityId: "browser-mutation",
  operationId: "browser-click",
  operationVersion: "1.0.0",
  approvalPolicy: { minimumMode: "owner" as const, userMayStrengthen: true as const }
};

describe("Browser owner approval acceptance rehearsal", () => {
  it("keeps a click pending until the owner approves, then executes the bound action once", async () => {
    const harness = createHarness();
    const pending = await harness.browser.requestOperation(request());
    const proposal = requirePendingProposal(pending);

    expect(proposal.status).toBe("proposed");
    expect(harness.executeBrowserAction).not.toHaveBeenCalled();
    await expect(
      harness.proposals.consumeAndExecute(binding(proposal), async () => ({ wrong: true }))
    ).rejects.toThrow(/awaiting owner approval/i);

    const response = await harness.approvals.handle(ownerMessage(), {
      type: "approve",
      proposalId: proposal.id
    });

    expect(response).toContain("Approved action completed");
    expect(harness.executeBrowserAction).toHaveBeenCalledOnce();
    expect(harness.executeBrowserAction).toHaveBeenCalledWith({
      workspaceId: "workspace-approval-fixture",
      operation: "browser-click",
      parameters: { selector: "#fixture-save" }
    });
    expect((await harness.proposalRepository.get(proposal.id))?.status).toBe("consumed");
  });

  it("records owner rejection without executing the click", async () => {
    const harness = createHarness();
    const pending = await harness.browser.requestOperation(request());
    const proposal = requirePendingProposal(pending);

    const response = await harness.approvals.handle(ownerMessage(), {
      type: "reject",
      proposalId: proposal.id
    });

    expect(response).toContain("will not run");
    expect((await harness.proposalRepository.get(proposal.id))?.status).toBe("rejected");
    expect(harness.executeBrowserAction).not.toHaveBeenCalled();
  });
});

function createHarness() {
  const proposalRepository = new FixtureProposalRepository();
  const proposals = new ActionProposalService({
    proposals: proposalRepository,
    ids: { nextId: () => "browser-proposal-fixture" },
    clock: { now: () => new Date("2026-10-05T10:00:00.000Z") }
  });
  const executeBrowserAction = vi.fn(async () => ({
    operation: "browser-click",
    selector: "#fixture-save",
    url: "http://127.0.0.1/fixture",
    title: "Local browser fixture"
  }));
  const browser = new BrowserActionService({ execute: executeBrowserAction }, proposals, {
    require: () => ({ pluginId: "browser", operation: reviewedOperation })
  });
  const executions = new ApprovalExecutionRegistry(proposals);
  executions.register({
    pluginId: "browser",
    operationId: "browser-click",
    execute: (proposal) => browser.executeApproved(proposal)
  });
  const approvals = new ApprovalCommandHandler(proposals, executions, {
    now: () => new Date("2026-10-05T10:01:00.000Z")
  });
  return { approvals, browser, executeBrowserAction, proposalRepository, proposals };
}

function request() {
  return {
    workspaceId: "workspace-approval-fixture",
    agentId: "browser",
    runId: "run-browser-fixture",
    pluginId: "browser",
    operationId: "browser-click",
    idempotencyKey: "browser-tool-call-fixture",
    expiresAt: "2026-10-06T10:00:00.000Z",
    parameters: { selector: " #fixture-save " }
  };
}

function ownerMessage() {
  return {
    schemaVersion: 1 as const,
    id: "matrix-owner-decision-fixture",
    traceId: "trace-browser-approval-fixture",
    transport: "matrix" as const,
    externalEventId: "$owner-decision-fixture",
    conversationId: "!browser-fixture:localhost",
    workspaceId: "workspace-approval-fixture",
    senderId: "@owner:localhost",
    receivedAt: "2026-10-05T10:01:00.000Z",
    kind: "command" as const,
    text: "/approve browser-proposal-fixture",
    attachments: [],
    metadata: {}
  };
}

function binding(proposal: ActionProposalV1) {
  return {
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
  };
}

function requirePendingProposal(
  result: Awaited<ReturnType<BrowserActionService["requestOperation"]>>
): ActionProposalV1 {
  if (result.outcome !== "pending") throw new Error("Expected the Browser action to be pending.");
  return result.proposal;
}

class FixtureProposalRepository implements ActionProposalRepositoryPort {
  private readonly records = new Map<string, ActionProposalV1>();

  async createIfAbsent(proposal: ActionProposalV1) {
    this.records.set(proposal.id, proposal);
    return { proposal, created: true };
  }

  async get(id: string) {
    return this.records.get(id);
  }

  async bindPrompt() {}

  async getByPromptExternalEvent() {
    return undefined;
  }

  async forwardDecision(decision: ActionApprovalDecisionV1) {
    const current = this.records.get(decision.proposalId);
    if (!current || current.status !== "proposed") return undefined;
    const next = {
      ...current,
      status: decision.decision === "approve" ? ("approved" as const) : ("rejected" as const)
    };
    this.records.set(next.id, next);
    return next;
  }

  async markExpired(input: { proposalId: string }) {
    const proposal = this.records.get(input.proposalId);
    if (!proposal) return undefined;
    const expired = { ...proposal, status: "expired" as const };
    this.records.set(expired.id, expired);
    return expired;
  }

  async cancelForRun() {
    return [];
  }

  async consume(input: Parameters<ActionProposalRepositoryPort["consume"]>[0]) {
    const proposal = this.records.get(input.proposalId);
    const bindingFields = [
      "workspaceId",
      "agentId",
      "runId",
      "pluginId",
      "capabilityId",
      "operationId",
      "operationVersion",
      "operationDigest",
      "idempotencyKey"
    ] as const;
    if (
      !proposal ||
      proposal.status !== "approved" ||
      bindingFields.some((field) => proposal[field] !== input[field])
    ) {
      return undefined;
    }
    const consumed = { ...proposal, status: "consumed" as const };
    this.records.set(consumed.id, consumed);
    return consumed;
  }
}
