import { describe, expect, it, vi } from "vitest";
import type { ActionApprovalDecisionV1, ActionProposalV1 } from "@second-brain/contracts";
import type { ClockPort, IdGeneratorPort } from "@second-brain/domain";

import {
  ActionProposalConflictError,
  ActionProposalExpiredError,
  ActionProposalPendingError,
  ActionProposalService,
  actionProposalOperationDigest,
  canonicalJson
} from "./approval-service.js";
import type { ActionProposalRepositoryPort } from "../../ports.js";

describe("ActionProposalService", () => {
  it("canonicalizes object key order and binds the reviewed operation", () => {
    expect(canonicalJson({ z: 1, a: [true, null] })).toBe('{"a":[true,null],"z":1}');
    const operation = {
      capabilityId: "publishing",
      operationId: "publish",
      operationVersion: "1.0.0",
      approvalPolicy: { minimumMode: "none" as const, userMayStrengthen: true as const }
    };
    expect(
      actionProposalOperationDigest({
        pluginId: "publishing-test",
        operation,
        parameters: { target: "reviewed" }
      })
    ).toBe(
      actionProposalOperationDigest({
        pluginId: "publishing-test",
        operation,
        parameters: { target: "reviewed" }
      })
    );
  });

  it("raises the requested policy to the reviewed minimum and is idempotent", async () => {
    const repository = new InMemoryActionProposalRepository();
    const service = new ActionProposalService({
      proposals: repository,
      ids: new FixedIds(),
      clock: new FixedClock()
    });
    const request = makeRequest({ minimumMode: "owner", approvalMode: "none" });

    const first = await service.createProposal(request);
    const retry = await service.createProposal(request);

    expect(first).toMatchObject({ status: "proposed", approvalMode: "owner" });
    expect(retry.id).toBe(first.id);
    expect(repository.createCalls).toBe(1);
  });

  it("automatically applies a user workspace policy that strengthens an operation", async () => {
    const repository = new InMemoryActionProposalRepository();
    const service = new ActionProposalService({
      proposals: repository,
      ids: new FixedIds(),
      clock: new FixedClock(),
      policies: { getMode: async () => "owner" }
    });
    const proposal = await service.createProposal(makeRequest({ minimumMode: "none" }));
    expect(proposal).toMatchObject({ approvalMode: "owner", status: "proposed" });
  });

  it("rejects changed canonical operation data and expired proposals", async () => {
    const repository = new InMemoryActionProposalRepository();
    const clock = new FixedClock();
    const service = new ActionProposalService({
      proposals: repository,
      ids: new FixedIds(),
      clock
    });
    const request = makeRequest({ minimumMode: "owner" });
    await expect(
      service.createProposal({ ...request, operationDigest: `sha256:${"0".repeat(64)}` })
    ).rejects.toThrow(/digest/i);

    const proposal = await service.createProposal(request, { approvalModeOverride: "owner" });
    expect(proposal.expiresAt).toBe("2026-08-30T12:00:00.000Z");
    clock.value = new Date("2026-08-30T12:00:00.000Z");
    await expect(
      service.forwardTrustedDecision({
        schemaVersion: 1,
        proposalId: proposal.id,
        workspaceId: proposal.workspaceId,
        ownerId: "owner-1",
        decision: "approve",
        decidedBy: "owner",
        decidedAt: clock.value.toISOString(),
        externalEventId: "$expired-decision"
      })
    ).rejects.toBeInstanceOf(ActionProposalExpiredError);
  });

  it("forwards a trusted owner decision and consumes an exact binding once", async () => {
    const repository = new InMemoryActionProposalRepository();
    const events: Array<{ type: string; operationId?: string }> = [];
    const service = new ActionProposalService({
      proposals: repository,
      ids: new FixedIds(),
      clock: new FixedClock(),
      securityEvents: { emit: (event) => events.push(event) }
    });
    const proposal = await service.createProposal(makeRequest({ minimumMode: "owner" }));
    const consumeInput = {
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

    const execute = vi.fn().mockResolvedValue({ pushed: true });
    await expect(service.consumeAndExecute(consumeInput, execute)).rejects.toBeInstanceOf(
      ActionProposalPendingError
    );
    await service.forwardTrustedDecision({
      schemaVersion: 1,
      proposalId: proposal.id,
      workspaceId: proposal.workspaceId,
      ownerId: "owner-1",
      decision: "approve",
      decidedBy: "owner",
      decidedAt: "2026-08-29T12:01:00.000Z",
      externalEventId: "$owner-event"
    });
    await expect(
      service.consumeAndExecute(
        { ...consumeInput, operationDigest: `sha256:${"1".repeat(64)}` },
        execute
      )
    ).rejects.toBeInstanceOf(ActionProposalConflictError);

    const consumed = await service.consumeAndExecute(consumeInput, execute);
    expect(consumed).toMatchObject({ outcome: "consumed", result: { pushed: true } });
    expect(execute).toHaveBeenCalledOnce();
    expect(events).toEqual([
      expect.objectContaining({ type: "approval.consumed", operationId: proposal.operationId })
    ]);
    await expect(service.consumeAndExecute(consumeInput, execute)).rejects.toBeInstanceOf(
      ActionProposalConflictError
    );
  });

  it("cancels proposals for one run and makes both approval paths fail closed", async () => {
    const repository = new InMemoryActionProposalRepository();
    const service = new ActionProposalService({
      proposals: repository,
      ids: new FixedIds(),
      clock: new FixedClock()
    });
    const proposed = await service.createProposal(makeRequest({ minimumMode: "owner" }));
    expect(await service.cancelForRun({ workspaceId: "workspace-1", runId: "run-1" })).toEqual([
      expect.objectContaining({ id: proposed.id, status: "cancelled" })
    ]);
    await expect(
      service.forwardTrustedDecision({
        schemaVersion: 1,
        proposalId: proposed.id,
        workspaceId: proposed.workspaceId,
        ownerId: "owner-1",
        decision: "approve",
        decidedBy: "owner",
        decidedAt: "2026-08-29T12:01:00.000Z",
        externalEventId: "$cancelled-decision"
      })
    ).rejects.toBeInstanceOf(ActionProposalConflictError);

    const approvedRepository = new InMemoryActionProposalRepository();
    const approvedService = new ActionProposalService({
      proposals: approvedRepository,
      ids: new FixedIds(),
      clock: new FixedClock()
    });
    const approved = await approvedService.createProposal(makeRequest({ minimumMode: "none" }));
    await approvedService.cancelForRun({
      workspaceId: approved.workspaceId,
      runId: approved.runId
    });
    await expect(
      approvedService.consumeAndExecute(
        {
          proposalId: approved.id,
          workspaceId: approved.workspaceId,
          agentId: approved.agentId,
          runId: approved.runId,
          pluginId: approved.pluginId,
          capabilityId: approved.capabilityId,
          operationId: approved.operationId,
          operationVersion: approved.operationVersion,
          operationDigest: approved.operationDigest,
          idempotencyKey: approved.idempotencyKey
        },
        async () => ({ ok: true })
      )
    ).rejects.toBeInstanceOf(ActionProposalConflictError);
  });
});

function makeRequest(input: {
  minimumMode: "none" | "owner";
  approvalMode?: "none" | "owner";
}): Parameters<ActionProposalService["createProposal"]>[0] {
  const operation = {
    capabilityId: "publishing",
    operationId: "publish",
    operationVersion: "1.0.0",
    approvalPolicy: { minimumMode: input.minimumMode, userMayStrengthen: true }
  } as const;
  const parameters = { target: "reviewed" };
  return {
    schemaVersion: 1,
    workspaceId: "workspace-1",
    agentId: "fixture-agent",
    runId: "run-1",
    pluginId: "publishing-test",
    operation,
    operationDigest: actionProposalOperationDigest({
      pluginId: "publishing-test",
      operation,
      parameters
    }),
    summary: "Publish reviewed content",
    parameters,
    approvalMode: input.approvalMode ?? "none",
    idempotencyKey: "publish:workspace-1:run-1:1",
    expiresAt: "2026-08-29T12:05:00.000Z"
  };
}

class FixedClock implements ClockPort {
  value = new Date("2026-08-29T12:00:00.000Z");
  now(): Date {
    return this.value;
  }
}

class FixedIds implements IdGeneratorPort {
  nextId(): string {
    return "proposal-1";
  }
}

class InMemoryActionProposalRepository implements ActionProposalRepositoryPort {
  private readonly records = new Map<string, ActionProposalV1>();
  createCalls = 0;

  async createIfAbsent(input: ActionProposalV1) {
    const existing = [...this.records.values()].find(
      (proposal) =>
        proposal.workspaceId === input.workspaceId &&
        proposal.runId === input.runId &&
        proposal.idempotencyKey === input.idempotencyKey
    );
    if (existing) return { proposal: existing, created: false };
    this.createCalls += 1;
    this.records.set(input.id, input);
    return { proposal: input, created: true };
  }

  async get(id: string): Promise<ActionProposalV1 | undefined> {
    return this.records.get(id);
  }

  async bindPrompt(): Promise<void> {}

  async getByPromptExternalEvent(): Promise<ActionProposalV1 | undefined> {
    return undefined;
  }

  async forwardDecision(input: ActionApprovalDecisionV1): Promise<ActionProposalV1 | undefined> {
    const proposal = this.records.get(input.proposalId);
    if (!proposal || proposal.status !== "proposed") return undefined;
    const updated = {
      ...proposal,
      status: input.decision === "approve" ? ("approved" as const) : ("rejected" as const)
    };
    this.records.set(proposal.id, updated);
    return updated;
  }

  async markExpired(input: {
    proposalId: string;
    now: Date;
  }): Promise<ActionProposalV1 | undefined> {
    const proposal = this.records.get(input.proposalId);
    if (!proposal || !["proposed", "approved"].includes(proposal.status)) return proposal;
    const updated = { ...proposal, status: "expired" as const };
    this.records.set(proposal.id, updated);
    return updated;
  }

  async cancelForRun(input: { workspaceId: string; runId: string; now: Date }) {
    void input.now;
    const cancelled: ActionProposalV1[] = [];
    for (const proposal of this.records.values()) {
      if (
        proposal.workspaceId === input.workspaceId &&
        proposal.runId === input.runId &&
        (proposal.status === "proposed" || proposal.status === "approved")
      ) {
        const updated = { ...proposal, status: "cancelled" as const };
        this.records.set(proposal.id, updated);
        cancelled.push(updated);
      }
    }
    return cancelled;
  }

  async consume(
    input: Parameters<ActionProposalRepositoryPort["consume"]>[0]
  ): Promise<ActionProposalV1 | undefined> {
    const proposal = this.records.get(input.proposalId);
    if (
      !proposal ||
      proposal.status !== "approved" ||
      proposal.workspaceId !== input.workspaceId ||
      proposal.agentId !== input.agentId ||
      proposal.runId !== input.runId ||
      proposal.operationDigest !== input.operationDigest ||
      proposal.idempotencyKey !== input.idempotencyKey
    ) {
      return undefined;
    }
    this.records.set(proposal.id, { ...proposal, status: "consumed" });
    return this.records.get(proposal.id);
  }
}
