import { describe, expect, it } from "vitest";

import {
  CORE_PLUGIN_MANIFEST_V2,
  CORE_REVIEWED_MODELS_V2
} from "@second-brain/core-agents-plugin/manifest";

import { compilePlatformCatalogV2, createPlatformAgentCatalog } from "../index.js";
import {
  INSTALLED_LOCAL_TOOL_FACTORY_IDS_V2,
  INSTALLED_PLUGIN_BROKER_PROVIDER_IDS_V2,
  INSTALLED_PLUGIN_MANIFESTS_V2,
  installedRuntimeClassesV2
} from "@second-brain/installed-plugins/catalog";

const BROWSER_PLUGIN_MANIFEST_V2 = INSTALLED_PLUGIN_MANIFESTS_V2.find(
  ({ id }) => id === "browser"
)!;

const image = (hex: string) => `jarvis/runtime@sha256:${hex.repeat(64)}`;

describe("legacy AgentCatalog adapter", () => {
  it("derives every legacy runtime decision from the compiled v2 artifact", () => {
    const compiled = compilePlatformCatalogV2({
      plugins: [
        { manifest: CORE_PLUGIN_MANIFEST_V2, files: resources() },
        { manifest: BROWSER_PLUGIN_MANIFEST_V2, files: resources() }
      ],
      runtimeClasses: installedRuntimeClassesV2({
        base: image("a"),
        browser: image("b"),
        isolated: image("c")
      }),
      reviewedModels: [...CORE_REVIEWED_MODELS_V2],
      localToolFactoryIds: [...INSTALLED_LOCAL_TOOL_FACTORY_IDS_V2],
      brokerProviderIds: [...INSTALLED_PLUGIN_BROKER_PROVIDER_IDS_V2]
    });
    const adapted = createPlatformAgentCatalog(compiled);

    expect(adapted.digest).toBe(compiled.digest);
    expect([...adapted.ids()].sort()).toEqual(
      [...CORE_PLUGIN_MANIFEST_V2.agents.map(({ id }) => id), "browser"].sort()
    );
    for (const compiledAgent of compiled.agents) {
      const agent = adapted.require(compiledAgent.id);
      const runtimeClass = compiled.runtimeClasses.find(
        ({ id }) => id === compiledAgent.runtimeClass
      )!;
      const expectedTools = compiledAgent.capabilityIds.flatMap(
        (capabilityId) =>
          compiled.capabilities.find((capability) => capability.capabilityId === capabilityId)!
            .toolIds
      );
      expect(agent).toMatchObject({
        id: compiledAgent.id,
        runtimeClass: compiledAgent.runtimeClass,
        promptPath: compiledAgent.promptPath,
        skillPaths: compiledAgent.skillPaths,
        extensionPaths: compiledAgent.extensionPaths,
        networkPolicy: runtimeClass.networkPolicy,
        workspaceAccess: compiledAgent.workspaceAccess,
        threadContextPolicy: compiledAgent.threadContextPolicy,
        model: compiledAgent.model,
        timeoutSeconds: compiledAgent.timeoutSeconds,
        tokenBudget: compiledAgent.tokenBudget,
        maxConcurrentRunsPerWorkspace: compiledAgent.maxConcurrentRunsPerWorkspace
      });
      expect(agent.delegation).toEqual(compiledAgent.delegation);
      expect([...agent.toolPolicy].sort()).toEqual([...expectedTools].sort());
      expect(Object.isFrozen(agent)).toBe(true);
    }
    expect(adapted.runtimeClass("brain").image).toBe(image("a"));
    expect(adapted.runtimeClass("browser").image).toBe(image("b"));
    expect(adapted.runtimeClass("orchestrator").image).toBe(image("c"));
  });

  it("fails closed for an unknown agent", () => {
    const adapted = createPlatformAgentCatalog(
      compilePlatformCatalogV2({
        plugins: [
          { manifest: CORE_PLUGIN_MANIFEST_V2, files: resources() },
          { manifest: BROWSER_PLUGIN_MANIFEST_V2, files: resources() }
        ],
        runtimeClasses: installedRuntimeClassesV2({
          base: image("a"),
          browser: image("b"),
          isolated: image("c")
        }),
        reviewedModels: [...CORE_REVIEWED_MODELS_V2],
        localToolFactoryIds: [...INSTALLED_LOCAL_TOOL_FACTORY_IDS_V2],
        brokerProviderIds: [...INSTALLED_PLUGIN_BROKER_PROVIDER_IDS_V2]
      })
    );

    expect(adapted.get("unknown")).toBeUndefined();
    expect(() => adapted.require("unknown")).toThrow("Unknown agent id in platform catalog");
  });
});

function resources(): Map<string, string> {
  const files = new Map<string, string>();
  for (const agent of [CORE_PLUGIN_MANIFEST_V2, BROWSER_PLUGIN_MANIFEST_V2].flatMap(
    (manifest) => manifest.agents
  )) {
    files.set(agent.promptPath, "reviewed prompt");
    for (const root of agent.skillPaths) files.set(`${root}/SKILL.md`, "reviewed skill");
    for (const path of agent.extensionPaths) files.set(path, "reviewed extension");
  }
  return files;
}
