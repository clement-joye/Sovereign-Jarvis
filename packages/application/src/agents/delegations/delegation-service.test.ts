import { describe, expect, it, vi } from "vitest";
import type {
  AgentArtifactV1,
  AgentRunV1,
  DelegationGrantV1,
  EffectiveRunPolicyV2
} from "@second-brain/contracts";
import type { AgentCollaborationRepositoryPort, JobQueuePort } from "../../ports.js";
import { DelegationService } from "./delegation-service.js";
import { DelegatedRunFactory } from "./delegated-run-factory.js";
import { createAgentCatalog, agentCatalogDigest } from "@second-brain/domain";
const c = {
  schemaVersion: 1 as const,
  version: "1.0.0",
  runtimeClasses: [
    {
      id: "base",
      image: `sha256:${"a".repeat(64)}`,
      networkPolicy: "none" as const,
      maxConcurrentRuns: 1,
      timeoutSeconds: 60,
      memoryMiB: 64,
      cpuMillicores: 100
    }
  ],
  agents: [
    {
      schemaVersion: 1 as const,
      id: "parent",
      defaultForWorkspace: true,
      version: "1.0.0",
      runtimeClass: "base",
      promptPath: "parent/x",
      skillPaths: [],
      extensionPaths: [],
      toolPolicy: ["workspace_read"],
      networkPolicy: "none" as const,
      workspaceAccess: "read" as const,
      timeoutSeconds: 60,
      tokenBudget: 10,
      maxConcurrentRunsPerWorkspace: 1,
      delegation: {
        mayDelegateTo: ["child"],
        toolPolicyByAgent: { child: ["workspace_read", "websearch"] },
        maxChildren: 1
      }
    },
    {
      schemaVersion: 1 as const,
      id: "child",
      version: "1.0.0",
      runtimeClass: "base",
      promptPath: "child/x",
      skillPaths: [],
      extensionPaths: [],
      toolPolicy: ["workspace_read", "websearch"],
      networkPolicy: "none" as const,
      workspaceAccess: "read" as const,
      timeoutSeconds: 60,
      tokenBudget: 10,
      maxConcurrentRunsPerWorkspace: 1
    }
  ]
};
describe("DelegationService", () =>
  it("creates a child record and idempotent durable job", async () => {
    const createRun = vi.fn(async (x: AgentRunV1) => x),
      enqueue = vi.fn(),
      hasLiveRootAdmission = vi.fn().mockResolvedValue(true);
    const runs: AgentCollaborationRepositoryPort = {
      claimDelegationNotice: async () => true,
      createRun,
      getRun: async () => undefined,
      listChildren: async () => [],
      updateRun: async (run) => run,
      createGrant: async (x: DelegationGrantV1) => x,
      getGrant: async () => undefined,
      createArtifact: async (x: AgentArtifactV1) => x,
      listArtifactsByRun: async () => []
    };
    const jobs: JobQueuePort = {
      enqueue,
      hasLiveRootAdmission,
      claim: async () => [],
      complete: async () => {},
      fail: async () => {
        throw new Error("Unexpected queue failure");
      }
    };
    const catalog = createAgentCatalog({ ...c, digest: agentCatalogDigest(c) });
    const s = new DelegationService(
      runs,
      jobs,
      new DelegatedRunFactory(catalog, { nextId: (p) => `${p}-1` }),
      { now: () => new Date("2026-08-18T20:00:00.000Z") }
    );
    await s.createChild({
      parent: {
        schemaVersion: 1,
        id: "parent-run",
        workspaceId: "w",
        agentId: "parent",
        catalogVersion: "1.0.0",
        catalogDigest: catalog.digest,
        status: "running",
        rootRunId: "root-run",
        deadlineAt: "2026-08-18T21:00:00.000Z",
        timeoutSeconds: 60,
        tokenBudget: 10,
        createdAt: "2026-08-18T20:00:00.000Z"
      },
      grant: {
        schemaVersion: 1,
        id: "g",
        parentRunId: "parent-run",
        workspaceId: "w",
        childAgentId: "child",
        allowedTools: ["websearch"],
        readablePaths: [],
        writablePaths: [],
        timeoutSeconds: 30,
        tokenBudget: 5,
        expiresAt: "2026-08-18T20:30:00.000Z"
      },
      task: "Fetch the weather in Stockholm.",
      effectiveRunPolicy: childPolicy(catalog.digest)
    });
    expect(createRun).toHaveBeenCalledOnce();
    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        rootRunId: "root-run",
        parentRunId: "parent-run",
        effectivePolicyDigest: `sha256:${"b".repeat(64)}`,
        runtimeImageId: `sha256:${"e".repeat(64)}`
      })
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "run_agent",
        idempotencyKey: "agent-run:w:g",
        payload: expect.objectContaining({
          rootRunId: "root-run",
          allowedTools: ["websearch"],
          effectivePolicyDigest: `sha256:${"b".repeat(64)}`
        })
      })
    );
    expect(hasLiveRootAdmission).toHaveBeenCalledWith(
      "root-run",
      new Date("2026-08-18T20:00:00.000Z")
    );
  }));

function childPolicy(catalogDigest: string): EffectiveRunPolicyV2 {
  return {
    schemaVersion: 2,
    catalogDigest,
    policyDigest: `sha256:${"b".repeat(64)}`,
    platformPolicyDigest: `sha256:${"c".repeat(64)}`,
    resourceDigest: `sha256:${"d".repeat(64)}`,
    runtimeImageId: `sha256:${"e".repeat(64)}`,
    workspaceId: "w",
    agentId: "child",
    pluginIds: ["core"],
    capabilityIds: [],
    toolIds: ["websearch"],
    skillPaths: [],
    extensionPaths: []
  };
}
