import type { ActionApprovalDecisionV1, ActionProposalV1 } from "@second-brain/contracts";
import type { ActionProposalRepositoryPort } from "@second-brain/application";

export class InMemoryActionProposalRepository implements ActionProposalRepositoryPort {
  private readonly records = new Map<string, ActionProposalV1>();
  private readonly promptOutbounds = new Map<string, string>();
  private readonly promptEvents = new Map<string, string>();
  private readonly idempotency = new Map<string, string>();
  private readonly decisionEvents = new Map<
    string,
    { proposalId: string; decision: "approve" | "reject" }
  >();
  private readonly maxRecords: number;

  constructor(options: { maxRecords?: number } = {}) {
    this.maxRecords = options.maxRecords ?? 256;
    if (!Number.isSafeInteger(this.maxRecords) || this.maxRecords < 1) {
      throw new Error("maxRecords must be a positive safe integer.");
    }
  }

  async createIfAbsent(
    input: ActionProposalV1
  ): Promise<{ proposal: ActionProposalV1; created: boolean }> {
    const key = this.idempotencyKey(input);
    const existingId = this.idempotency.get(key);
    if (existingId) {
      const existing = this.records.get(existingId);
      if (existing) return { proposal: existing, created: false };
      this.idempotency.delete(key);
    }

    if (this.records.size >= this.maxRecords) {
      throw new Error("In-memory action proposal repository capacity exhausted.");
    }
    this.records.set(input.id, input);
    this.idempotency.set(key, input.id);
    return { proposal: input, created: true };
  }

  async get(id: string): Promise<ActionProposalV1 | undefined> {
    return this.records.get(id);
  }

  async bindPrompt(input: {
    proposalId: string;
    workspaceId: string;
    outboundMessageId: string;
  }): Promise<void> {
    const proposal = this.records.get(input.proposalId);
    if (!proposal || proposal.workspaceId !== input.workspaceId || proposal.status !== "proposed") {
      throw new Error("Action proposal approval prompt could not be bound.");
    }
    const existing = this.promptOutbounds.get(input.proposalId);
    if (existing && existing !== input.outboundMessageId) {
      throw new Error("Action proposal approval prompt is already bound.");
    }
    this.promptOutbounds.set(input.proposalId, input.outboundMessageId);
  }

  async getByPromptExternalEvent(input: {
    workspaceId: string;
    externalEventId: string;
  }): Promise<ActionProposalV1 | undefined> {
    const proposalId = this.promptEvents.get(input.externalEventId);
    const proposal = proposalId ? this.records.get(proposalId) : undefined;
    return proposal?.workspaceId === input.workspaceId ? proposal : undefined;
  }

  /** Test-adapter hook mirroring a delivered Matrix prompt event. */
  bindPromptExternalEvent(proposalId: string, externalEventId: string): void {
    if (!this.promptOutbounds.has(proposalId)) throw new Error("Approval prompt is not bound.");
    this.promptEvents.set(externalEventId, proposalId);
  }

  async forwardDecision(input: ActionApprovalDecisionV1): Promise<ActionProposalV1 | undefined> {
    const proposal = this.records.get(input.proposalId);
    const event = this.decisionEvents.get(input.externalEventId);
    if (event) {
      if (event.proposalId !== input.proposalId || event.decision !== input.decision)
        return undefined;
      return proposal;
    }
    if (!proposal || proposal.status !== "proposed" || proposal.workspaceId !== input.workspaceId)
      return undefined;

    const decidedAt = new Date(input.decidedAt).getTime();
    if (!Number.isFinite(decidedAt)) return undefined;
    if (decidedAt >= new Date(proposal.expiresAt).getTime()) {
      const expired = { ...proposal, status: "expired" as const };
      this.records.set(proposal.id, expired);
      return undefined;
    }

    const updated = {
      ...proposal,
      status: input.decision === "approve" ? ("approved" as const) : ("rejected" as const)
    };
    this.records.set(proposal.id, updated);
    this.decisionEvents.set(input.externalEventId, {
      proposalId: proposal.id,
      decision: input.decision
    });
    return updated;
  }

  async markExpired(input: {
    proposalId: string;
    now: Date;
  }): Promise<ActionProposalV1 | undefined> {
    const proposal = this.records.get(input.proposalId);
    if (!proposal) return undefined;
    if (
      (proposal.status === "proposed" || proposal.status === "approved") &&
      input.now.getTime() >= new Date(proposal.expiresAt).getTime()
    ) {
      const expired = { ...proposal, status: "expired" as const };
      this.records.set(proposal.id, expired);
      return expired;
    }
    return proposal;
  }

  async cancelForRun(input: {
    workspaceId: string;
    runId: string;
    now: Date;
  }): Promise<ActionProposalV1[]> {
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
    if (!proposal || proposal.status !== "approved") return undefined;
    if (input.now.getTime() >= new Date(proposal.expiresAt).getTime()) {
      this.records.set(proposal.id, { ...proposal, status: "expired" });
      return undefined;
    }
    const fields = [
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
    if (fields.some((field) => proposal[field] !== input[field])) return undefined;
    const consumed = { ...proposal, status: "consumed" as const };
    this.records.set(proposal.id, consumed);
    return consumed;
  }

  private idempotencyKey(input: ActionProposalV1): string {
    return `${input.workspaceId}\u0000${input.runId}\u0000${input.idempotencyKey}`;
  }
}

/** In-memory equivalent of the bounded user-strengthening policy store. */
