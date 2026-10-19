import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { INITIAL_AGENT_CATALOG } from "@second-brain/domain";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

import { RoleResourceResolver } from "../executions/pi-role-resources.js";

import {
  activePiToolNames,
  modelSelectionForAgent,
  PiCodingAgentModelProvider,
  PiRunBudgetMeter,
  piSessionDirectory,
  resolvePiRoleResources
} from "./coding-agent-model-provider.js";

describe("PiCodingAgentModelProvider", () => {
  it("keeps an optional filtered profile root distinct from the writable workspace", () => {
    const provider = new PiCodingAgentModelProvider({
      sessionRoot: "/sessions",
      workspaceRoot: "/workspace",
      profileRoot: "/profile",
      modelsPath: "/profile/models.json",
      providerId: "provider",
      modelId: "model",
      brainControlUrl: "http://control.test",
      agentCatalog: INITIAL_AGENT_CATALOG,
      platformCatalog: {} as never
    });
    expect(provider).toBeDefined();
  });

  it("loads the selected role pack without discovering shared Brain instructions", () => {
    expect(
      resolvePiRoleResources(
        { workspaceRoot: "/workspace", profileRoot: "/profile" },
        "/sessions/session-1/pi-agent",
        INITIAL_AGENT_CATALOG.require("orchestrator")
      )
    ).toEqual({
      resourceRoot: "/profile",
      agentDir: "/sessions/session-1/pi-agent",
      systemPrompt: "/profile/orchestrator/AGENTS.md",
      additionalSkillPaths: ["/profile/orchestrator/skills"]
    });
  });

  it("resolves prompts and skills from the role-resource root before the executable profile", () => {
    expect(
      resolvePiRoleResources(
        {
          workspaceRoot: "/workspace",
          profileRoot: "/profile",
          resourceRoot: "/role-resources"
        },
        "/sessions/session-1/pi-agent",
        INITIAL_AGENT_CATALOG.require("orchestrator")
      )
    ).toEqual({
      resourceRoot: "/role-resources",
      agentDir: "/sessions/session-1/pi-agent",
      systemPrompt: "/role-resources/orchestrator/AGENTS.md",
      additionalSkillPaths: ["/role-resources/orchestrator/skills"]
    });
  });

  it("does not load executable extensions without an executable profile root", async () => {
    const resolver = new RoleResourceResolver({
      workspaceRoot: "/workspace",
      resourceRoot: "/role-resources"
    });

    await expect(resolver.loadExtensions(["extensions/should-not-load.ts"])).resolves.toEqual([]);
  });

  it("creates fresh Pi SDK state when the reviewed role or catalog changes", () => {
    const orchestratorDirectory = piSessionDirectory(
      "/sessions",
      "session-1",
      "orchestrator",
      `sha256:${"a".repeat(64)}`
    );

    expect(orchestratorDirectory).toBe(
      `/sessions/session-1/pi-agent-orchestrator-${"a".repeat(64)}`
    );
    expect(
      piSessionDirectory("/sessions", "session-1", "brain", `sha256:${"a".repeat(64)}`)
    ).not.toBe(orchestratorDirectory);
    expect(
      piSessionDirectory("/sessions", "session-1", "orchestrator", `sha256:${"b".repeat(64)}`)
    ).not.toBe(orchestratorDirectory);
  });

  it("uses a reviewed per-agent model and falls back when it is omitted", () => {
    expect(
      modelSelectionForAgent(INITIAL_AGENT_CATALOG.require("brain"), {
        providerId: "fallback-provider",
        modelId: "fallback-model"
      })
    ).toEqual({
      providerId: "omlx",
      modelId: "Qwen3.6-35B-A3B-OptiQ-4bit:profile-qwen-general"
    });
    expect(
      modelSelectionForAgent(
        { ...INITIAL_AGENT_CATALOG.require("brain"), model: undefined },
        { providerId: "fallback-provider", modelId: "fallback-model" }
      )
    ).toEqual({ providerId: "fallback-provider", modelId: "fallback-model" });
  });

  it("keeps selected custom tools active with an explicit Pi allowlist", () => {
    expect(
      activePiToolNames(
        ["workspace_list", "workspace_read", "delegate"],
        [
          { name: "workspace_list" },
          { name: "workspace_read" },
          { name: "delegate" },
          { name: "delegate_status" }
        ]
      )
    ).toEqual(["workspace_list", "workspace_read", "delegate", "delegate_status"]);
    expect(activePiToolNames(["websearch", "browser_navigate"], [])).toEqual([
      "websearch",
      "browser_navigate"
    ]);
  });

  it("enforces cumulative token and byte budgets across a complete run", () => {
    const tokenMeter = new PiRunBudgetMeter(10, 100);
    tokenMeter.addAssistantUsage(6);
    expect(() => tokenMeter.addAssistantUsage(5)).toThrow("10 token budget");

    const unlimitedMeter = new PiRunBudgetMeter("unlimited", 100);
    expect(() => unlimitedMeter.addAssistantUsage(1_000_001)).not.toThrow();

    const outputMeter = new PiRunBudgetMeter(100, 5);
    expect(outputMeter.addText("", "å")).toBe("å");
    outputMeter.consumeOutput(3);
    expect(() => outputMeter.addText("å", "x")).toThrow("5 byte output budget");
  });

  it("registers Browser's Playwright skill with the Pi loader", async () => {
    const profileRoot = fileURLToPath(
      new URL("../../../../plugins/browser/resources", import.meta.url)
    );
    const sessionDirectory = await mkdtemp(join(tmpdir(), "jarvis-browser-session-"));
    try {
      const agent = INITIAL_AGENT_CATALOG.require("browser");
      const resources = resolvePiRoleResources(
        { workspaceRoot: "/workspace", profileRoot },
        sessionDirectory,
        agent
      );
      const loader = new DefaultResourceLoader({
        cwd: "/workspace",
        agentDir: resources.agentDir,
        systemPrompt: resources.systemPrompt,
        noContextFiles: true,
        additionalSkillPaths: resources.additionalSkillPaths
      });
      await loader.reload();

      expect(loader.getSkills().skills.map((skill) => skill.name)).toContain("playwright-evidence");
    } finally {
      await rm(sessionDirectory, { recursive: true, force: true });
    }
  });

  it("keeps Browser mutation behind its broker rather than its local extension", () => {
    const extensionPath = fileURLToPath(
      new URL("../../../../plugins/browser/resources/extensions/browser/index.ts", import.meta.url)
    );
    const source = readFileSync(extensionPath, "utf8");
    expect(source).not.toMatch(/name:\s*["']browser_(click|type)["']/u);
  });
});
