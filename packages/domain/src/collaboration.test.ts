import { describe, expect, it } from "vitest";

import type { DelegationGrantV1 } from "@second-brain/contracts";

import { createAgentCatalog, agentCatalogDigest } from "./agent-catalog.js";
import {
  acquireWorkspaceWriteLease,
  canReleaseWorkspaceWriteLease,
  effectiveDelegatedTools,
  renewWorkspaceWriteLease
} from "./collaboration.js";

const catalogContent = {
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
      promptPath: "parent/AGENTS.md",
      skillPaths: [],
      extensionPaths: [],
      toolPolicy: ["workspace_read", "workspace_write"],
      networkPolicy: "none" as const,
      workspaceAccess: "scoped-write" as const,
      timeoutSeconds: 60,
      tokenBudget: 100,
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
      promptPath: "child/AGENTS.md",
      skillPaths: [],
      extensionPaths: [],
      toolPolicy: ["workspace_read", "workspace_write", "websearch"],
      networkPolicy: "none" as const,
      workspaceAccess: "scoped-write" as const,
      timeoutSeconds: 60,
      tokenBudget: 100,
      maxConcurrentRunsPerWorkspace: 1
    }
  ]
};
const catalog = createAgentCatalog({
  ...catalogContent,
  digest: agentCatalogDigest(catalogContent)
});
const grant: DelegationGrantV1 = {
  schemaVersion: 1,
  id: "grant-1",
  parentRunId: "parent-run",
  workspaceId: "workspace-1",
  childAgentId: "child",
  allowedTools: ["workspace_read", "websearch"],
  readablePaths: ["notes/project"],
  writablePaths: ["notes/project"],
  timeoutSeconds: 30,
  tokenBudget: 50,
  expiresAt: "2026-08-18T21:00:00.000Z"
};

describe("collaboration authority", () => {
  it("uses delegated authority without exposing child tools to the parent", () => {
    expect(catalog.require("parent").toolPolicy).not.toContain("websearch");
    expect(effectiveDelegatedTools(catalog, "parent", "child", grant)).toEqual([
      "workspace_read",
      "websearch"
    ]);
  });

  it("rejects tools outside delegation policy and missing path grants", () => {
    expect(() =>
      effectiveDelegatedTools(catalog, "parent", "child", {
        ...grant,
        allowedTools: ["workspace_write"]
      })
    ).toThrow("may not delegate tool workspace_write");
    expect(() =>
      effectiveDelegatedTools(catalog, "parent", "child", { ...grant, readablePaths: [] })
    ).toThrow("requires readable paths");
  });

  it("serializes workspace writes and recovers after expiry", () => {
    const now = new Date("2026-08-18T20:00:00.000Z");
    const lease = acquireWorkspaceWriteLease(undefined, {
      id: "lease-1",
      workspaceId: "workspace-1",
      ownerRunId: "run-1",
      now,
      leaseMs: 60_000
    });
    expect(() =>
      acquireWorkspaceWriteLease(lease, {
        id: "lease-2",
        workspaceId: "workspace-1",
        ownerRunId: "run-2",
        now,
        leaseMs: 60_000
      })
    ).toThrow("active write lease");
    const recovered = acquireWorkspaceWriteLease(lease, {
      id: "lease-2",
      workspaceId: "workspace-1",
      ownerRunId: "run-2",
      now: new Date("2026-08-18T20:01:01.000Z"),
      leaseMs: 60_000
    });
    expect(recovered.ownerRunId).toBe("run-2");
  });

  it("allows only the owner to renew or release an active lease", () => {
    const now = new Date("2026-08-18T20:00:00.000Z");
    const lease = acquireWorkspaceWriteLease(undefined, {
      id: "lease-1",
      workspaceId: "workspace-1",
      ownerRunId: "run-1",
      now,
      leaseMs: 60_000
    });
    expect(() =>
      renewWorkspaceWriteLease(lease, { ownerRunId: "run-2", now, leaseMs: 60_000 })
    ).toThrow("Only the lease owner");
    expect(canReleaseWorkspaceWriteLease(lease, "run-1")).toBe(true);
    expect(canReleaseWorkspaceWriteLease(lease, "run-2")).toBe(false);
  });
});
