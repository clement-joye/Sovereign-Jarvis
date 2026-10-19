import { describe, expect, it } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";
import type { ActionProposalV1 } from "@second-brain/contracts/schemas";

import { PostgresActionProposalRepository } from "./action-proposal-repository.js";
import type { PostgresQueryable } from "../job-queue.js";

const proposal = {
  schemaVersion: 1 as const,
  id: "proposal-1",
  operationDigest: `sha256:${"a".repeat(64)}`,
  workspaceId: "workspace-1",
  agentId: "brain",
  runId: "run-1",
  pluginId: "git",
  capabilityId: "sample-repository",
  operationId: "push",
  operationVersion: "1.0.0",
  summary: "Push the reviewed branch",
  parameters: { branch: "main" },
  approvalMode: "owner" as const,
  requiredApprover: "owner" as const,
  idempotencyKey: "push-main-1",
  status: "proposed" as const,
  createdAt: "2026-08-29T10:00:00.000Z",
  expiresAt: "2026-08-29T10:05:00.000Z"
};

describe("PostgresActionProposalRepository", () => {
  it("binds a proposal to its outbound prompt and resolves the delivered Matrix event", async () => {
    const db = new RecordingDb([[{}], [row(proposal)]]);
    const repository = new PostgresActionProposalRepository(db);

    await repository.bindPrompt({
      proposalId: proposal.id,
      workspaceId: proposal.workspaceId,
      outboundMessageId: "outbound-prompt-1"
    });
    await expect(
      repository.getByPromptExternalEvent({
        workspaceId: proposal.workspaceId,
        externalEventId: "$prompt-event"
      })
    ).resolves.toMatchObject({ id: proposal.id });

    expect(db.calls[0]?.sql).toContain('"approval_prompt_outbound_id" = $1');
    expect(db.calls[0]?.values).toEqual([
      "outbound-prompt-1",
      proposal.id,
      proposal.workspaceId,
      "proposed",
      "outbound-prompt-1"
    ]);
    expect(db.calls[1]?.sql).toContain('"delivery"."external_event_id" = $4');
    expect(db.calls[1]?.values).toEqual([
      proposal.workspaceId,
      "matrix",
      "delivered",
      "$prompt-event"
    ]);
  });

  it("returns the durable idempotent record when creation loses a uniqueness race", async () => {
    const db = new RecordingDb([[], [row(proposal)]]);
    const repository = new PostgresActionProposalRepository(db);

    await expect(repository.createIfAbsent(proposal)).resolves.toEqual({
      proposal,
      created: false
    });
    expect(db.calls[0]?.sql).toContain(
      'on conflict ("workspace_id", "run_id", "idempotency_key") do nothing'
    );
    expect(db.calls[1]?.sql).toContain(
      'where "workspace_id" = $1 and "run_id" = $2 and "idempotency_key" = $3'
    );
    expect(db.calls[1]?.values).toEqual([
      proposal.workspaceId,
      proposal.runId,
      proposal.idempotencyKey
    ]);
  });

  it("forwards only a live proposed owner decision and records trusted metadata", async () => {
    const db = new RecordingDb([[row({ ...proposal, status: "approved" })]]);
    const repository = new PostgresActionProposalRepository(db);

    await expect(
      repository.forwardDecision({
        schemaVersion: 1,
        proposalId: proposal.id,
        workspaceId: proposal.workspaceId,
        ownerId: "owner-1",
        decision: "approve",
        decidedBy: "owner",
        decidedAt: "2026-08-29T10:01:00.000Z",
        externalEventId: "matrix-event-1",
        reason: "Reviewed"
      })
    ).resolves.toMatchObject({ ...proposal, status: "approved" });
    expect(db.calls[0]?.sql).toContain('"status" = $10');
    expect(db.calls[0]?.sql).toContain('"expires_at" > $13');
    expect(db.calls[0]?.sql).toContain('"required_approver" = $11');
    expect(db.calls[0]?.values).toEqual([
      "approved",
      "2026-08-29T10:01:00.000Z",
      "owner",
      proposal.workspaceId,
      "owner-1",
      "matrix-event-1",
      "Reviewed",
      proposal.id,
      proposal.workspaceId,
      "proposed",
      "owner",
      "2026-08-29T10:01:00.000Z",
      "2026-08-29T10:01:00.000Z"
    ]);
  });

  it("expires with a CAS and consumes exactly one approved binding", async () => {
    const db = new RecordingDb([
      [row({ ...proposal, status: "expired" })],
      [row({ ...proposal, status: "consumed" })]
    ]);
    const repository = new PostgresActionProposalRepository(db);

    await expect(
      repository.markExpired({
        proposalId: proposal.id,
        now: new Date("2026-08-29T10:06:00.000Z")
      })
    ).resolves.toMatchObject({ status: "expired" });
    await expect(
      repository.consume({
        proposalId: proposal.id,
        workspaceId: proposal.workspaceId,
        agentId: proposal.agentId,
        runId: proposal.runId,
        pluginId: proposal.pluginId,
        capabilityId: proposal.capabilityId,
        operationId: proposal.operationId,
        operationVersion: proposal.operationVersion,
        operationDigest: proposal.operationDigest,
        idempotencyKey: proposal.idempotencyKey,
        now: new Date("2026-08-29T10:03:00.000Z")
      })
    ).resolves.toMatchObject({ status: "consumed" });
    expect(db.calls[0]?.sql).toContain('"status" in ($3, $4)');
    expect(db.calls[0]?.values?.slice(0, 4)).toEqual([
      "expired",
      proposal.id,
      "proposed",
      "approved"
    ]);
    expect(db.calls[1]?.sql).toContain('"status" = $12');
    expect(db.calls[1]?.sql).toContain('set "status" = $1');
    expect(db.calls[1]?.sql).toContain('"operation_digest" = $10');
  });

  it("cancels only actionable proposals for the exact workspace and run", async () => {
    const db = new RecordingDb([[row({ ...proposal, status: "cancelled" })], [], []]);
    const repository = new PostgresActionProposalRepository(db);
    const now = new Date("2026-08-29T10:02:00.000Z");

    await expect(
      repository.cancelForRun({ workspaceId: proposal.workspaceId, runId: proposal.runId, now })
    ).resolves.toMatchObject([{ id: proposal.id, status: "cancelled" }]);
    expect(db.calls[0]?.sql).toContain('"workspace_id" = $2');
    expect(db.calls[0]?.sql).toContain('"run_id" = $3');
    expect(db.calls[0]?.sql).toContain('"status" in ($4, $5)');
    expect(db.calls[0]?.values).toEqual([
      "cancelled",
      proposal.workspaceId,
      proposal.runId,
      "proposed",
      "approved"
    ]);

    await expect(
      repository.forwardDecision({
        schemaVersion: 1,
        proposalId: proposal.id,
        workspaceId: proposal.workspaceId,
        ownerId: "owner-1",
        decision: "approve",
        decidedBy: "owner",
        decidedAt: now.toISOString(),
        externalEventId: "matrix-event-cancelled"
      })
    ).resolves.toBeUndefined();
    await expect(
      repository.consume({
        proposalId: proposal.id,
        workspaceId: proposal.workspaceId,
        agentId: proposal.agentId,
        runId: proposal.runId,
        pluginId: proposal.pluginId,
        capabilityId: proposal.capabilityId,
        operationId: proposal.operationId,
        operationVersion: proposal.operationVersion,
        operationDigest: proposal.operationDigest,
        idempotencyKey: proposal.idempotencyKey,
        now
      })
    ).resolves.toBeUndefined();
  });
});

class RecordingDb implements PostgresQueryable {
  readonly calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
  private index = 0;

  constructor(private readonly rows: QueryResultRow[][]) {}

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<T>> {
    this.calls.push(values ? { sql: text, values } : { sql: text });
    const rows = (this.rows[this.index++] ?? []) as T[];
    const command = text.trimStart().split(" ", 1)[0]?.toUpperCase() ?? "SELECT";
    return { command, oid: 0, fields: [], rows, rowCount: rows.length };
  }
}

function row(overrides: Partial<ActionProposalV1> = {}): QueryResultRow {
  const value = { ...proposal, ...overrides } as ActionProposalV1;
  return {
    id: value.id,
    schema_version: value.schemaVersion,
    operation_digest: value.operationDigest,
    workspace_id: value.workspaceId,
    agent_id: value.agentId,
    run_id: value.runId,
    plugin_id: value.pluginId,
    capability_id: value.capabilityId,
    operation_id: value.operationId,
    operation_version: value.operationVersion,
    summary: value.summary,
    parameters: value.parameters,
    approval_mode: value.approvalMode,
    required_approver: value.requiredApprover,
    idempotency_key: value.idempotencyKey,
    status: value.status,
    created_at: value.createdAt,
    expires_at: value.expiresAt
  };
}
