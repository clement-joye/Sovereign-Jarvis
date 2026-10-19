import { describe, expect, it } from "vitest";

import { agentCatalogDigest, createAgentCatalog, INITIAL_AGENT_CATALOG } from "./agent-catalog.js";

function catalogContent() {
  return {
    schemaVersion: 1 as const,
    version: "1.0.0",
    runtimeClasses: [
      {
        id: "base",
        image: `sha256:${"a".repeat(64)}`,
        networkPolicy: "restricted" as const,
        maxConcurrentRuns: 1,
        timeoutSeconds: 600,
        memoryMiB: 4096,
        cpuMillicores: 4000
      }
    ],
    agents: [
      {
        schemaVersion: 1 as const,
        id: "brain",
        defaultForWorkspace: true,
        version: "1.0.0",
        runtimeClass: "base",
        promptPath: "brain/AGENTS.md",
        skillPaths: ["brain/skills"],
        extensionPaths: [],
        toolPolicy: ["workspace_read"],
        networkPolicy: "restricted" as const,
        workspaceAccess: "write" as const,
        timeoutSeconds: 600,
        tokenBudget: 100_000,
        maxConcurrentRunsPerWorkspace: 1
      }
    ]
  };
}

describe("agent catalog", () => {
  it("keeps the non-development agents as the initial catalog entries", () => {
    expect(INITIAL_AGENT_CATALOG.ids()).toEqual([
      "brain",
      "orchestrator",
      "router",
      "browser",
      "document-analyzer",
      "scheduler"
    ]);
    expect(INITIAL_AGENT_CATALOG.require("brain").threadContextPolicy).toBe(
      "fresh_session_with_thread_history"
    );
    for (const agentId of INITIAL_AGENT_CATALOG.ids()) {
      expect(INITIAL_AGENT_CATALOG.require(agentId).threadContextPolicy).toBe(
        "fresh_session_with_thread_history"
      );
    }
    for (const agentId of ["orchestrator", "router", "document-analyzer", "scheduler"]) {
      expect(INITIAL_AGENT_CATALOG.runtimeClass(agentId).id).toBe("isolated");
    }
    expect(INITIAL_AGENT_CATALOG.runtimeClass("scheduler").networkPolicy).toBe("none");
    expect(INITIAL_AGENT_CATALOG.runtimeClass("browser").id).toBe("browser");
    expect(INITIAL_AGENT_CATALOG.require("browser").toolPolicy).toContain("web_fetch");
    expect(INITIAL_AGENT_CATALOG.require("browser").toolPolicy).toContain("browser_click");
    expect(INITIAL_AGENT_CATALOG.require("browser").toolPolicy).toContain("browser_type");
    expect(INITIAL_AGENT_CATALOG.require("browser").toolPolicy).not.toContain("bash");
    expect(INITIAL_AGENT_CATALOG.require("document-analyzer")).toMatchObject({
      version: "1.1.0",
      toolPolicy: ["workspace_write", "attachment_save"]
    });
    expect(INITIAL_AGENT_CATALOG.require("brain").extensionPaths).toContain(
      "extensions/extra-tools/index.ts"
    );
    expect(INITIAL_AGENT_CATALOG.require("browser").extensionPaths).toEqual([
      "extensions/browser/index.ts"
    ]);
  });

  it("gives every initial agent an 800,000-token run budget", () => {
    for (const agentId of INITIAL_AGENT_CATALOG.ids()) {
      expect(INITIAL_AGENT_CATALOG.require(agentId).tokenBudget).toBe(800_000);
    }
  });

  it("rejects unknown agent IDs at the catalog boundary", () => {
    expect(() => INITIAL_AGENT_CATALOG.require("not-reviewed")).toThrow(
      "Unknown agent id in reviewed catalog"
    );
  });

  it("detects catalog content changes through its digest", () => {
    const content = catalogContent();
    expect(() => createAgentCatalog({ ...content, digest: `sha256:${"0".repeat(64)}` })).toThrow(
      "digest does not match"
    );
    const catalog = createAgentCatalog({ ...content, digest: agentCatalogDigest(content) });
    expect(catalog.require("brain").promptPath).toBe("brain/AGENTS.md");
  });

  it("rejects unreviewed paths and delegation targets", () => {
    const content = catalogContent();
    expect(() =>
      createAgentCatalog({
        ...content,
        agents: [{ ...content.agents[0]!, promptPath: "other/AGENTS.md" }],
        digest: agentCatalogDigest(content)
      })
    ).toThrow("Prompt path must be scoped to agent brain");
  });
});
