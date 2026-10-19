import { describe, expect, it } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";
import type { AgentRunV1 } from "@second-brain/contracts/schemas";

import { PostgresAgentCollaborationRepository } from "./agent-collaboration-repository.js";
import type { PostgresQueryable } from "../job-queue.js";

const digest = `sha256:${"a".repeat(64)}`;
const executionIdentity = {
  effectivePolicyDigest: `sha256:${"b".repeat(64)}`,
  platformPolicyDigest: `sha256:${"c".repeat(64)}`,
  resourceDigest: `sha256:${"d".repeat(64)}`,
  runtimeImageId: `jarvis/runtime@sha256:${"e".repeat(64)}`
};
const run: AgentRunV1 = {
  schemaVersion: 1 as const,
  id: "run-1",
  workspaceId: "workspace-1",
  agentId: "planner",
  catalogVersion: "1.0.0",
  catalogDigest: digest,
  status: "queued" as const,
  rootRunId: "run-1",
  deadlineAt: "2026-08-18T21:00:00.000Z",
  timeoutSeconds: 60,
  tokenBudget: 1000,
  createdAt: "2026-08-18T20:00:00.000Z"
};
const grant = {
  schemaVersion: 1 as const,
  id: "grant-1",
  parentRunId: "run-1",
  workspaceId: "workspace-1",
  childAgentId: "document-analyzer",
  allowedTools: ["workspace_read"],
  readablePaths: ["notes/project"],
  writablePaths: ["notes/project"],
  timeoutSeconds: 30,
  tokenBudget: 500,
  expiresAt: "2026-08-18T20:30:00.000Z"
};
const artifact = {
  schemaVersion: 1 as const,
  id: "artifact-1",
  workspaceId: "workspace-1",
  producingRunId: "run-1",
  agentId: "planner",
  catalogVersion: "1.0.0",
  catalogDigest: digest,
  kind: "plan" as const,
  storageKey: "artifacts/plan.md",
  sha256: "b".repeat(64),
  createdAt: "2026-08-18T20:01:00.000Z"
};

describe("PostgresAgentCollaborationRepository", () => {
  it("persists run, grant, and artifact provenance without credentials", async () => {
    const db = new RecordingDb([[runRow()], [grantRow()], [artifactRow()]]);
    const repository = new PostgresAgentCollaborationRepository(db);
    await expect(repository.createRun(run)).resolves.toMatchObject(run);
    expect(db.calls[0]?.sql).toContain("root_run_id");
    expect(db.calls[0]?.values?.[10]).toBe(run.rootRunId);
    expect(db.calls[0]?.values?.slice(0, 20)).toHaveLength(20);
    await expect(repository.createGrant(grant)).resolves.toMatchObject(grant);
    await expect(repository.createArtifact(artifact)).resolves.toMatchObject(artifact);
    expect(db.calls.map((call) => call.sql)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('insert into "brain_core"."agent_runs"'),
        expect.stringContaining('insert into "brain_core"."delegation_grants"'),
        expect.stringContaining('insert into "brain_core"."agent_artifacts"')
      ])
    );
  });

  it("round-trips a bounded child text result on terminal updates", async () => {
    const completed = {
      ...run,
      status: "completed" as const,
      startedAt: "2026-08-18T20:00:01.000Z",
      completedAt: "2026-08-18T20:00:02.000Z",
      resultText: "Child completed the requested analysis."
    };
    const db = new RecordingDb([[runRow(completed)]]);
    const repository = new PostgresAgentCollaborationRepository(db);

    await expect(repository.updateRun(completed)).resolves.toMatchObject(completed);
    expect(db.calls[0]?.sql).toContain('"result_text" = $4');
    expect(db.calls[0]?.values?.[3]).toBe(completed.resultText);
  });

  it("retrieves the durable delegation grant used by a worker", async () => {
    const db = new RecordingDb([[grantRow()]]);
    const repository = new PostgresAgentCollaborationRepository(db);

    await expect(repository.getGrant("grant-1")).resolves.toEqual(grant);
    expect(db.calls[0]).toMatchObject({ values: ["grant-1"] });
    expect(db.calls[0]?.sql).toContain('from "brain_core"."delegation_grants"');
  });

  it("round-trips an explicit unlimited budget as SQL NULL", async () => {
    const unlimitedRun: AgentRunV1 = { ...run, tokenBudget: "unlimited" };
    const db = new RecordingDb([[runRow(unlimitedRun)]]);
    const repository = new PostgresAgentCollaborationRepository(db);

    await expect(repository.createRun(unlimitedRun)).resolves.toMatchObject(unlimitedRun);
    expect(db.calls[0]?.values).toContain(null);
  });

  it("round-trips durable execution identities while retaining legacy NULL records", async () => {
    const identifiedRun: AgentRunV1 = { ...run, ...executionIdentity };
    const db = new RecordingDb([[runRow(identifiedRun)], [runRow()]]);
    const repository = new PostgresAgentCollaborationRepository(db);

    await expect(repository.createRun(identifiedRun)).resolves.toMatchObject(identifiedRun);
    await expect(repository.getRun(run.id)).resolves.toEqual(run);
  });

  it("round-trips the trusted notice origin for delegated runs", async () => {
    const noticedRun: AgentRunV1 = {
      ...run,
      noticeOrigin: {
        conversationId: "!room:example",
        replyToExternalEventId: "$reply",
        threadRootExternalEventId: "$root"
      }
    };
    const db = new RecordingDb([[runRow(noticedRun)]]);
    const repository = new PostgresAgentCollaborationRepository(db);

    await expect(repository.createRun(noticedRun)).resolves.toMatchObject(noticedRun);
    expect(db.calls[0]?.values).toContainEqual(noticedRun.noticeOrigin);
  });

  it("does not mutate persisted execution identities during status updates", async () => {
    const storedRun: AgentRunV1 = { ...run, ...executionIdentity };
    const attemptedMutation: AgentRunV1 = {
      ...storedRun,
      status: "completed",
      effectivePolicyDigest: `sha256:${"f".repeat(64)}`,
      startedAt: "2026-08-18T20:00:01.000Z",
      completedAt: "2026-08-18T20:00:02.000Z"
    };
    const db = new RecordingDb([[runRow({ ...storedRun, status: "completed" })]]);
    const repository = new PostgresAgentCollaborationRepository(db);

    await expect(repository.updateRun(attemptedMutation)).resolves.toMatchObject({
      ...storedRun,
      status: "completed"
    });
    expect(db.calls[0]?.sql).not.toContain("effective_policy_digest");
    expect(db.calls[0]?.sql).not.toContain("platform_policy_digest");
    expect(db.calls[0]?.sql).not.toContain("resource_digest");
    expect(db.calls[0]?.sql).not.toContain("runtime_image_id");
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
    return { command: "SELECT", oid: 0, fields: [], rows, rowCount: rows.length };
  }
}
function runRow(value: AgentRunV1 = run): QueryResultRow {
  return {
    id: value.id,
    workspace_id: value.workspaceId,
    agent_id: value.agentId,
    catalog_version: value.catalogVersion,
    catalog_digest: value.catalogDigest,
    effective_policy_digest: value.effectivePolicyDigest ?? null,
    platform_policy_digest: value.platformPolicyDigest ?? null,
    resource_digest: value.resourceDigest ?? null,
    runtime_image_id: value.runtimeImageId ?? null,
    status: value.status,
    root_run_id: value.rootRunId,
    parent_run_id: null,
    delegation_grant_id: null,
    deadline_at: value.deadlineAt,
    timeout_seconds: value.timeoutSeconds,
    token_budget: value.tokenBudget === "unlimited" ? null : value.tokenBudget,
    created_at: value.createdAt,
    started_at: value.startedAt ?? null,
    completed_at: value.completedAt ?? null,
    result_text: value.resultText ?? null,
    notice_origin: value.noticeOrigin ?? null
  };
}
function grantRow(): QueryResultRow {
  return {
    id: grant.id,
    parent_run_id: grant.parentRunId,
    workspace_id: grant.workspaceId,
    child_agent_id: grant.childAgentId,
    allowed_tools: grant.allowedTools,
    readable_paths: grant.readablePaths,
    writable_paths: grant.writablePaths,
    timeout_seconds: grant.timeoutSeconds,
    token_budget: grant.tokenBudget,
    expires_at: grant.expiresAt
  };
}
function artifactRow(): QueryResultRow {
  return {
    id: artifact.id,
    workspace_id: artifact.workspaceId,
    producing_run_id: artifact.producingRunId,
    parent_run_id: null,
    agent_id: artifact.agentId,
    catalog_version: artifact.catalogVersion,
    catalog_digest: artifact.catalogDigest,
    kind: artifact.kind,
    storage_key: artifact.storageKey,
    sha256: artifact.sha256,
    created_at: artifact.createdAt
  };
}
