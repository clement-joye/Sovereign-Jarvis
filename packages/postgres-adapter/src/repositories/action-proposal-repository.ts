import type { ActionProposalRepositoryPort } from "@second-brain/application/ports/approvals";
import {
  ActionApprovalDecisionV1Schema,
  ActionProposalV1Schema,
  type ActionApprovalDecisionV1,
  type ActionProposalV1
} from "@second-brain/contracts/schemas";

import type { PostgresQueryable } from "../postgres-queryable.js";
import { typedDatabase, type TypedPostgresDatabase } from "../typed-database.js";

interface ActionProposalRow {
  id: string;
  schema_version: number;
  operation_digest: string;
  workspace_id: string;
  agent_id: string;
  run_id: string;
  plugin_id: string;
  capability_id: string;
  operation_id: string;
  operation_version: string;
  summary: string;
  parameters: Record<string, unknown>;
  approval_mode: ActionProposalV1["approvalMode"];
  required_approver: ActionProposalV1["requiredApprover"];
  idempotency_key: string;
  status: ActionProposalV1["status"];
  created_at: string | Date;
  expires_at: string | Date;
}

/**
 * Durable CAS boundary for generic action approval. Every state-changing
 * operation includes its expected state and deadline in the SQL predicate so
 * retries and concurrent owner/worker requests cannot grant authority twice.
 */
export class PostgresActionProposalRepository implements ActionProposalRepositoryPort {
  private readonly db: TypedPostgresDatabase;

  constructor(source: PostgresQueryable) {
    this.db = typedDatabase(source);
  }

  async createIfAbsent(input: ActionProposalV1): Promise<{
    proposal: ActionProposalV1;
    created: boolean;
  }> {
    const proposal = ActionProposalV1Schema.parse(input);
    const insertedRow = await this.db
      .withSchema("brain_core")
      .insertInto("action_proposals")
      .values(proposalValues(proposal))
      .onConflict((conflict) =>
        conflict.columns(["workspace_id", "run_id", "idempotency_key"]).doNothing()
      )
      .returningAll()
      .executeTakeFirst();
    if (insertedRow) return { proposal: rowToProposal(insertedRow), created: true };

    const existingRow = await this.db
      .withSchema("brain_core")
      .selectFrom("action_proposals")
      .selectAll()
      .where("workspace_id", "=", proposal.workspaceId)
      .where("run_id", "=", proposal.runId)
      .where("idempotency_key", "=", proposal.idempotencyKey)
      .executeTakeFirst();
    if (!existingRow) {
      throw new Error("Action proposal conflict did not return the existing idempotent record.");
    }
    return { proposal: rowToProposal(existingRow), created: false };
  }

  async get(id: string): Promise<ActionProposalV1 | undefined> {
    const row = await this.db
      .withSchema("brain_core")
      .selectFrom("action_proposals")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return row ? rowToProposal(row) : undefined;
  }

  async bindPrompt(input: {
    proposalId: string;
    workspaceId: string;
    outboundMessageId: string;
  }): Promise<void> {
    const result = await this.db
      .withSchema("brain_core")
      .updateTable("action_proposals")
      .set("approval_prompt_outbound_id", input.outboundMessageId)
      .where("id", "=", input.proposalId)
      .where("workspace_id", "=", input.workspaceId)
      .where("status", "=", "proposed")
      .where((expression) =>
        expression.or([
          expression("approval_prompt_outbound_id", "is", null),
          expression("approval_prompt_outbound_id", "=", input.outboundMessageId)
        ])
      )
      .executeTakeFirst();
    if (result.numUpdatedRows === 0n) {
      throw new Error("Action proposal approval prompt could not be bound.");
    }
  }

  async getByPromptExternalEvent(input: {
    workspaceId: string;
    externalEventId: string;
  }): Promise<ActionProposalV1 | undefined> {
    const row = await this.db
      .withSchema("brain_core")
      .selectFrom("action_proposals as proposal")
      .innerJoin(
        "delivery_attempts as delivery",
        "delivery.outbound_message_id",
        "proposal.approval_prompt_outbound_id"
      )
      .selectAll("proposal")
      .where("proposal.workspace_id", "=", input.workspaceId)
      .where("delivery.transport", "=", "matrix")
      .where("delivery.status", "=", "delivered")
      .where("delivery.external_event_id", "=", input.externalEventId)
      .executeTakeFirst();
    return row ? rowToProposal(row) : undefined;
  }

  async forwardDecision(input: ActionApprovalDecisionV1): Promise<ActionProposalV1 | undefined> {
    const decision = ActionApprovalDecisionV1Schema.parse(input);
    const row = await this.db
      .withSchema("brain_core")
      .updateTable("action_proposals")
      .set({
        status: decision.decision === "approve" ? "approved" : "rejected",
        decided_at: decision.decidedAt,
        decided_by: decision.decidedBy,
        decision_workspace_id: decision.workspaceId,
        decision_owner_id: decision.ownerId,
        decision_external_event_id: decision.externalEventId,
        decision_reason: decision.reason ?? null
      })
      .where("id", "=", decision.proposalId)
      .where("workspace_id", "=", decision.workspaceId)
      .where("status", "=", "proposed")
      .where("required_approver", "=", "owner")
      .where("created_at", "<=", decision.decidedAt)
      .where("expires_at", ">", decision.decidedAt)
      .returningAll()
      .executeTakeFirst();
    return row ? rowToProposal(row) : undefined;
  }

  async markExpired(input: {
    proposalId: string;
    now: Date;
  }): Promise<ActionProposalV1 | undefined> {
    const row = await this.db
      .withSchema("brain_core")
      .updateTable("action_proposals")
      .set("status", "expired")
      .where("id", "=", input.proposalId)
      .where("status", "in", ["proposed", "approved"])
      .where("expires_at", "<=", input.now)
      .returningAll()
      .executeTakeFirst();
    return row ? rowToProposal(row) : undefined;
  }

  async cancelForRun(input: {
    workspaceId: string;
    runId: string;
    now: Date;
  }): Promise<ActionProposalV1[]> {
    // `now` is part of the port contract for a deterministic cancellation
    // boundary, even though the durable schema records only the terminal
    // status today.
    void input.now;
    const rows = await this.db
      .withSchema("brain_core")
      .updateTable("action_proposals")
      .set("status", "cancelled")
      .where("workspace_id", "=", input.workspaceId)
      .where("run_id", "=", input.runId)
      .where("status", "in", ["proposed", "approved"])
      .returningAll()
      .execute();
    return rows.map(rowToProposal);
  }

  /**
   * Atomically consumes one exact authorization. The UPDATE is the CAS: no
   * caller can observe an approved record and then race another caller before
   * the approved -> consumed transition is committed.
   */
  async consume(input: Parameters<ActionProposalRepositoryPort["consume"]>[0]) {
    const row = await this.db
      .withSchema("brain_core")
      .updateTable("action_proposals")
      .set("status", "consumed")
      .where("id", "=", input.proposalId)
      .where("workspace_id", "=", input.workspaceId)
      .where("agent_id", "=", input.agentId)
      .where("run_id", "=", input.runId)
      .where("plugin_id", "=", input.pluginId)
      .where("capability_id", "=", input.capabilityId)
      .where("operation_id", "=", input.operationId)
      .where("operation_version", "=", input.operationVersion)
      .where("operation_digest", "=", input.operationDigest)
      .where("idempotency_key", "=", input.idempotencyKey)
      .where("status", "=", "approved")
      .where("expires_at", ">", input.now)
      .returningAll()
      .executeTakeFirst();
    return row ? rowToProposal(row) : undefined;
  }
}

function proposalValues(proposal: ActionProposalV1) {
  return {
    id: proposal.id,
    schema_version: proposal.schemaVersion,
    operation_digest: proposal.operationDigest,
    workspace_id: proposal.workspaceId,
    agent_id: proposal.agentId,
    run_id: proposal.runId,
    plugin_id: proposal.pluginId,
    capability_id: proposal.capabilityId,
    operation_id: proposal.operationId,
    operation_version: proposal.operationVersion,
    summary: proposal.summary,
    parameters: proposal.parameters,
    approval_mode: proposal.approvalMode,
    required_approver: proposal.requiredApprover,
    idempotency_key: proposal.idempotencyKey,
    status: proposal.status,
    created_at: proposal.createdAt,
    expires_at: proposal.expiresAt,
    decided_at: null,
    decided_by: null,
    decision_workspace_id: null,
    decision_owner_id: null,
    decision_external_event_id: null,
    decision_reason: null,
    approval_prompt_outbound_id: null
  };
}

function rowToProposal(row: ActionProposalRow): ActionProposalV1 {
  return ActionProposalV1Schema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    operationDigest: row.operation_digest,
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    runId: row.run_id,
    pluginId: row.plugin_id,
    capabilityId: row.capability_id,
    operationId: row.operation_id,
    operationVersion: row.operation_version,
    summary: row.summary,
    parameters: row.parameters,
    approvalMode: row.approval_mode,
    requiredApprover: row.required_approver,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString()
  });
}
