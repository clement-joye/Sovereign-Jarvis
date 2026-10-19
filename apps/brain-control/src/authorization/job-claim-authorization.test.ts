import { describe, expect, it, vi } from "vitest";

import type { AgentRunV1, EffectiveRunPolicyV2, InternalJobV1 } from "@second-brain/contracts";
import { INITIAL_AGENT_CATALOG } from "@second-brain/domain";

import { authorizeClaimedRuns } from "./job-claim-authorization.js";
import { RunAuthorizationService } from "./run-authorization.js";

const now = new Date("2026-09-21T10:00:00.000Z");

describe("authorizeClaimedRuns execution identity", () => {
  it("terminalizes a legacy queued run without guessing identities from the active policy", async () => {
    const { claimed, fail, updateRun } = await authorize(run(), policy());

    expect(claimed).toEqual([]);
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ retryable: false, maxAttempts: 1 })
    );
    expect(updateRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", resultText: expect.stringMatching(/legacy/i) })
    );
  });

  it("terminalizes queued work when the current effective policy differs from its durable identity", async () => {
    const original = policy();
    const durable = identifiedRun(original);
    const changed = { ...original, policyDigest: digest("f") };
    const { claimed, fail, updateRun } = await authorize(durable, changed);

    expect(claimed).toEqual([]);
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ retryable: false, maxAttempts: 1 })
    );
    expect(updateRun).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("issues work only when the queued and claim-time identities match exactly", async () => {
    const current = policy();
    const { claimed, fail } = await authorize(identifiedRun(current), current);

    expect(fail).not.toHaveBeenCalled();
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ effectiveRunPolicies: [current] });
    expect(claimed[0]?.runAuthorization).toBeTypeOf("string");
  });
});

async function authorize(runValue: AgentRunV1, currentPolicy: EffectiveRunPolicyV2) {
  const job = claimedJob(runValue);
  const fail = vi.fn(async () => ({ ...job, status: "dead_letter" as const }));
  const updateRun = vi.fn(async (value: AgentRunV1) => value);
  const claimed = await authorizeClaimedRuns(
    [job],
    {
      jobs: { fail } as never,
      runs: { getRun: vi.fn().mockResolvedValue(runValue), updateRun },
      agentCatalog: INITIAL_AGENT_CATALOG,
      runAuthorizations: new RunAuthorizationService("x".repeat(32), () => now),
      effectiveRunPolicies: {
        resolve: vi.fn().mockResolvedValue(currentPolicy),
        resolveIfActive: vi.fn()
      }
    },
    now
  );
  return { claimed, fail, updateRun };
}

function claimedJob(runValue: AgentRunV1): InternalJobV1 {
  return {
    schemaVersion: 1,
    id: "job-1",
    workspaceId: runValue.workspaceId,
    type: "run_agent",
    payload: {
      runId: runValue.id,
      allowedTools: ["workspace_read"],
      ...(runValue.effectivePolicyDigest
        ? { effectivePolicyDigest: runValue.effectivePolicyDigest }
        : {})
    },
    priority: 50,
    status: "leased",
    attempts: 1,
    availableAt: now.toISOString(),
    idempotencyKey: "agent-run:workspace-1:grant-1",
    leaseOwner: "worker-1",
    leaseExpiresAt: new Date(now.getTime() + 60_000).toISOString()
  };
}

function run(): AgentRunV1 {
  return {
    schemaVersion: 1,
    id: "run-1",
    workspaceId: "workspace-1",
    agentId: "brain",
    catalogVersion: INITIAL_AGENT_CATALOG.version,
    catalogDigest: INITIAL_AGENT_CATALOG.digest,
    status: "queued",
    rootRunId: "root-1",
    parentRunId: "root-1",
    delegationGrantId: "grant-1",
    deadlineAt: new Date(now.getTime() + 60_000).toISOString(),
    timeoutSeconds: 60,
    tokenBudget: 1_000,
    createdAt: now.toISOString()
  };
}

function identifiedRun(value: EffectiveRunPolicyV2): AgentRunV1 {
  return {
    ...run(),
    effectivePolicyDigest: value.policyDigest,
    platformPolicyDigest: value.platformPolicyDigest,
    resourceDigest: value.resourceDigest,
    runtimeImageId: value.runtimeImageId
  };
}

function policy(): EffectiveRunPolicyV2 {
  return {
    schemaVersion: 2,
    catalogDigest: INITIAL_AGENT_CATALOG.digest,
    policyDigest: digest("b"),
    platformPolicyDigest: digest("c"),
    resourceDigest: digest("d"),
    runtimeImageId: digest("e"),
    workspaceId: "workspace-1",
    agentId: "brain",
    pluginIds: ["core"],
    capabilityIds: [],
    toolIds: ["workspace_read"],
    skillPaths: [],
    extensionPaths: []
  };
}

function digest(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}
