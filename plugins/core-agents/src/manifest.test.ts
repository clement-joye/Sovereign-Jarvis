import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CORE_PLUGIN_MANIFEST_V2 } from "./manifest.js";

describe("core-agents plugin", () => {
  it("preserves the reviewed core identities", () => {
    expect(CORE_PLUGIN_MANIFEST_V2.id).toBe("core-agents");
    expect(CORE_PLUGIN_MANIFEST_V2.agents.map(({ id }) => id)).toEqual([
      "brain",
      "orchestrator",
      "router",
      "document-analyzer",
      "scheduler"
    ]);
  });

  it("contains every declared agent resource", () => {
    const root = join(process.cwd(), "plugins/core-agents/resources");
    for (const agent of CORE_PLUGIN_MANIFEST_V2.agents) {
      for (const path of [agent.promptPath, ...agent.skillPaths, ...agent.extensionPaths]) {
        expect(existsSync(join(root, path))).toBe(true);
      }
    }
    expect(readFileSync(join(root, "brain/AGENTS.md"), "utf8")).toContain("Brain");
  });

  it("keeps assistant capabilities and delegation bounded", () => {
    const byId = new Map(CORE_PLUGIN_MANIFEST_V2.agents.map((agent) => [agent.id, agent]));
    expect(byId.get("brain")).toMatchObject({
      runtimeClass: "base",
      workspaceAccess: "write",
      capabilityIds: expect.arrayContaining([
        "pi-bash",
        "workspace-write",
        "workspace-edit",
        "planner-delegation"
      ]),
      delegation: { maxChildren: 1 }
    });
    expect(byId.get("brain")?.delegation?.mayDelegateTo).toEqual([
      "browser",
      "document-analyzer",
      "scheduler"
    ]);
    expect(byId.get("orchestrator")?.delegation?.mayDelegateTo).toEqual([
      "brain",
      "browser",
      "document-analyzer",
      "scheduler"
    ]);
    expect(byId.get("orchestrator")?.routing?.keywords).toContain("plan");
    expect(byId.get("orchestrator")?.delegation?.toolPolicyByAgent.browser).toContain("websearch");
    expect(byId.get("orchestrator")?.capabilityIds).not.toContain("websearch");
    expect(byId.get("orchestrator")).toMatchObject({
      runtimeClass: "isolated",
      workspaceAccess: "scoped-write",
      capabilityIds: expect.arrayContaining([
        "workspace-read",
        "workspace-write",
        "workspace-edit",
        "planner-delegation"
      ]),
      delegation: { maxChildren: 1 }
    });
    expect(byId.get("orchestrator")?.capabilityIds).not.toContain("pi-bash");
    expect(byId.get("orchestrator")?.delegation?.mayDelegateTo).not.toContain("orchestrator");
  });

  it("includes durable recovery and bounded delegation instructions", () => {
    const root = join(process.cwd(), "plugins/core-agents/resources/orchestrator");
    const prompt = readFileSync(join(root, "AGENTS.md"), "utf8");
    const planSkill = readFileSync(join(root, "skills/plan-management/SKILL.md"), "utf8");
    const delegationSkill = readFileSync(join(root, "skills/bounded-delegation/SKILL.md"), "utf8");
    expect(prompt).toContain("Before starting or resuming, read the relevant file in `.plan/`");
    expect(planSkill).toContain("`uncertain`");
    expect(delegationSkill).toContain("A later run cannot inspect an earlier parent's children");
    expect(delegationSkill).toContain("completed `resultText`");
    expect(delegationSkill).toContain("the cause is unknown");
  });

  it("tells Brain about Orchestrator without assigning delegation to Router", () => {
    const root = join(process.cwd(), "plugins/core-agents/resources");
    const brainPrompt = readFileSync(join(root, "brain/AGENTS.md"), "utf8");
    const routerPrompt = readFileSync(join(root, "router/AGENTS.md"), "utf8");
    expect(brainPrompt).toContain("`@orchestrator`");
    expect(brainPrompt).not.toContain("`@planner`");
    expect(brainPrompt).toContain("Router only classifies");
    expect(brainPrompt).toContain("`/agents` command to check the current catalog");
    expect(readFileSync(join(root, "brain/skills/delegation/SKILL.md"), "utf8")).toContain(
      "Read the child's completed `resultText`"
    );
    expect(routerPrompt).toContain("Never access workspace files");
  });
});
