import type { AgentCollaborationRepositoryPort } from "@second-brain/application/ports/agents";
import {
  AgentArtifactV1Schema,
  AgentRunV1Schema,
  DelegationGrantV1Schema,
  type AgentArtifactV1,
  type AgentRunNoticeOriginV1,
  type AgentRunV1,
  type DelegationGrantV1
} from "@second-brain/contracts/schemas";

import type { PostgresQueryable } from "../postgres-queryable.js";
import type { PostgresTransactionSource } from "../transaction.js";
import { typedDatabase, type TypedPostgresDatabase } from "../typed-database.js";
import { withTransaction } from "../transaction.js";

interface AgentRunRow {
  id: string;
  workspace_id: string;
  agent_id: string;
  catalog_version: string;
  catalog_digest: string;
  effective_policy_digest: string | null;
  platform_policy_digest: string | null;
  resource_digest: string | null;
  runtime_image_id: string | null;
  status: AgentRunV1["status"];
  root_run_id: string;
  parent_run_id: string | null;
  delegation_grant_id: string | null;
  deadline_at: string | Date;
  timeout_seconds: number;
  token_budget: number | null;
  created_at: string | Date;
  started_at: string | Date | null;
  completed_at: string | Date | null;
  result_text: string | null;
  notice_origin: AgentRunNoticeOriginV1 | null;
}
interface DelegationGrantRow {
  id: string;
  parent_run_id: string;
  workspace_id: string;
  child_agent_id: string;
  allowed_tools: string[];
  readable_paths: string[];
  writable_paths: string[];
  timeout_seconds: number;
  token_budget: number | null;
  expires_at: string | Date;
}
interface AgentArtifactRow {
  id: string;
  workspace_id: string;
  producing_run_id: string;
  parent_run_id: string | null;
  agent_id: string;
  catalog_version: string;
  catalog_digest: string;
  kind: AgentArtifactV1["kind"];
  storage_key: string;
  sha256: string;
  created_at: string | Date;
}

/** Persists non-secret collaboration provenance records owned by the control plane. */
export class PostgresAgentCollaborationRepository implements AgentCollaborationRepositoryPort {
  private readonly db: TypedPostgresDatabase;
  private readonly queryable: PostgresQueryable & Partial<PostgresTransactionSource>;

  constructor(queryable: PostgresQueryable) {
    this.queryable = queryable;
    this.db = typedDatabase(queryable);
  }

  async claimDelegationNotice(
    rootRunId: string,
    childRunId: string,
    limit: number
  ): Promise<boolean> {
    if (!Number.isInteger(limit) || limit < 1)
      throw new Error("Notice limit must be a positive integer.");
    const source = this.queryable;
    if (!source.connect) throw new Error("Delegation notice claims require a PostgreSQL pool.");
    return withTransaction(source as PostgresTransactionSource, async (client) => {
      const root = await client.query(
        "SELECT id FROM brain_core.agent_runs WHERE id = $1 FOR UPDATE",
        [rootRunId]
      );
      if (root.rowCount !== 1) throw new Error(`Root agent run ${rootRunId} does not exist.`);
      const prior = await client.query<{ notice_allowed: boolean }>(
        "SELECT notice_allowed FROM brain_core.delegation_notice_claims WHERE root_run_id = $1 AND child_run_id = $2",
        [rootRunId, childRunId]
      );
      if (prior.rows[0]) return prior.rows[0].notice_allowed;
      const count = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM brain_core.delegation_notice_claims WHERE root_run_id = $1 AND notice_allowed",
        [rootRunId]
      );
      const allowed = Number(count.rows[0]?.count ?? 0) < limit;
      await client.query(
        "INSERT INTO brain_core.delegation_notice_claims (root_run_id, child_run_id, notice_allowed) VALUES ($1, $2, $3)",
        [rootRunId, childRunId, allowed]
      );
      return allowed;
    });
  }

  async createRun(run: AgentRunV1): Promise<AgentRunV1> {
    const row = await this.db
      .withSchema("brain_core")
      .insertInto("agent_runs")
      .values({
        id: run.id,
        workspace_id: run.workspaceId,
        agent_id: run.agentId,
        catalog_version: run.catalogVersion,
        catalog_digest: run.catalogDigest,
        effective_policy_digest: run.effectivePolicyDigest ?? null,
        platform_policy_digest: run.platformPolicyDigest ?? null,
        resource_digest: run.resourceDigest ?? null,
        runtime_image_id: run.runtimeImageId ?? null,
        status: run.status,
        root_run_id: run.rootRunId,
        parent_run_id: run.parentRunId ?? null,
        delegation_grant_id: run.delegationGrantId ?? null,
        deadline_at: run.deadlineAt,
        timeout_seconds: run.timeoutSeconds,
        token_budget: encodeTokenBudget(run.tokenBudget),
        created_at: run.createdAt,
        started_at: run.startedAt ?? null,
        completed_at: run.completedAt ?? null,
        result_text: run.resultText ?? null,
        notice_origin: run.noticeOrigin ?? null
      })
      .onConflict((conflict) => conflict.column("id").doUpdateSet({ id: run.id }))
      .returningAll()
      .executeTakeFirstOrThrow();
    return AgentRunV1Schema.parse(rowToRun(row));
  }

  async getRun(id: string): Promise<AgentRunV1 | undefined> {
    const row = await this.db
      .withSchema("brain_core")
      .selectFrom("agent_runs")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return row ? AgentRunV1Schema.parse(rowToRun(row)) : undefined;
  }

  async listChildren(parentRunId: string): Promise<AgentRunV1[]> {
    const rows = await this.db
      .withSchema("brain_core")
      .selectFrom("agent_runs")
      .selectAll()
      .where("parent_run_id", "=", parentRunId)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();
    return rows.map((row) => AgentRunV1Schema.parse(rowToRun(row)));
  }

  async updateRun(run: AgentRunV1): Promise<AgentRunV1> {
    const row = await this.db
      .withSchema("brain_core")
      .updateTable("agent_runs")
      .set({
        status: run.status,
        started_at: run.startedAt ?? null,
        completed_at: run.completedAt ?? null,
        result_text: run.resultText ?? null
      })
      .where("id", "=", run.id)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new Error(`Unknown agent run: ${run.id}`);
    return AgentRunV1Schema.parse(rowToRun(row));
  }

  async createGrant(grant: DelegationGrantV1): Promise<DelegationGrantV1> {
    const row = await this.db
      .withSchema("brain_core")
      .insertInto("delegation_grants")
      .values({
        id: grant.id,
        parent_run_id: grant.parentRunId,
        workspace_id: grant.workspaceId,
        child_agent_id: grant.childAgentId,
        allowed_tools: grant.allowedTools,
        readable_paths: grant.readablePaths,
        writable_paths: grant.writablePaths,
        timeout_seconds: grant.timeoutSeconds,
        token_budget: encodeTokenBudget(grant.tokenBudget),
        expires_at: grant.expiresAt
      })
      .onConflict((conflict) => conflict.column("id").doUpdateSet({ id: grant.id }))
      .returningAll()
      .executeTakeFirstOrThrow();
    return DelegationGrantV1Schema.parse(rowToGrant(row));
  }

  async getGrant(id: string): Promise<DelegationGrantV1 | undefined> {
    const row = await this.db
      .withSchema("brain_core")
      .selectFrom("delegation_grants")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return row ? DelegationGrantV1Schema.parse(rowToGrant(row)) : undefined;
  }

  async createArtifact(artifact: AgentArtifactV1): Promise<AgentArtifactV1> {
    const row = await this.db
      .withSchema("brain_core")
      .insertInto("agent_artifacts")
      .values({
        id: artifact.id,
        workspace_id: artifact.workspaceId,
        producing_run_id: artifact.producingRunId,
        parent_run_id: artifact.parentRunId ?? null,
        agent_id: artifact.agentId,
        catalog_version: artifact.catalogVersion,
        catalog_digest: artifact.catalogDigest,
        kind: artifact.kind,
        storage_key: artifact.storageKey,
        sha256: artifact.sha256,
        created_at: artifact.createdAt
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return AgentArtifactV1Schema.parse(rowToArtifact(row));
  }

  async listArtifactsByRun(runId: string): Promise<AgentArtifactV1[]> {
    const rows = await this.db
      .withSchema("brain_core")
      .selectFrom("agent_artifacts")
      .selectAll()
      .where("producing_run_id", "=", runId)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();
    return rows.map((row) => AgentArtifactV1Schema.parse(rowToArtifact(row)));
  }
}
function rowToRun(row: AgentRunRow): object {
  return {
    schemaVersion: 1,
    id: row.id,
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    catalogVersion: row.catalog_version,
    catalogDigest: row.catalog_digest,
    ...(row.effective_policy_digest ? { effectivePolicyDigest: row.effective_policy_digest } : {}),
    ...(row.platform_policy_digest ? { platformPolicyDigest: row.platform_policy_digest } : {}),
    ...(row.resource_digest ? { resourceDigest: row.resource_digest } : {}),
    ...(row.runtime_image_id ? { runtimeImageId: row.runtime_image_id } : {}),
    status: row.status,
    rootRunId: row.root_run_id,
    ...(row.parent_run_id ? { parentRunId: row.parent_run_id } : {}),
    ...(row.delegation_grant_id ? { delegationGrantId: row.delegation_grant_id } : {}),
    deadlineAt: iso(row.deadline_at),
    timeoutSeconds: row.timeout_seconds,
    tokenBudget: decodeTokenBudget(row.token_budget),
    createdAt: iso(row.created_at),
    ...(row.started_at ? { startedAt: iso(row.started_at) } : {}),
    ...(row.completed_at ? { completedAt: iso(row.completed_at) } : {}),
    ...(row.result_text ? { resultText: row.result_text } : {}),
    ...(row.notice_origin ? { noticeOrigin: row.notice_origin } : {})
  };
}
function rowToGrant(row: DelegationGrantRow): object {
  return {
    schemaVersion: 1,
    id: row.id,
    parentRunId: row.parent_run_id,
    workspaceId: row.workspace_id,
    childAgentId: row.child_agent_id,
    allowedTools: row.allowed_tools,
    readablePaths: row.readable_paths,
    writablePaths: row.writable_paths,
    timeoutSeconds: row.timeout_seconds,
    tokenBudget: decodeTokenBudget(row.token_budget),
    expiresAt: iso(row.expires_at)
  };
}
function rowToArtifact(row: AgentArtifactRow): object {
  return {
    schemaVersion: 1,
    id: row.id,
    workspaceId: row.workspace_id,
    producingRunId: row.producing_run_id,
    ...(row.parent_run_id ? { parentRunId: row.parent_run_id } : {}),
    agentId: row.agent_id,
    catalogVersion: row.catalog_version,
    catalogDigest: row.catalog_digest,
    kind: row.kind,
    storageKey: row.storage_key,
    sha256: row.sha256,
    createdAt: iso(row.created_at)
  };
}
function iso(value: string | Date): string {
  return new Date(value).toISOString();
}
function encodeTokenBudget(value: AgentRunV1["tokenBudget"]): number | null {
  return value === "unlimited" ? null : value;
}
function decodeTokenBudget(value: number | null): AgentRunV1["tokenBudget"] {
  return value ?? "unlimited";
}
