import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CORE_PLUGIN } from "@second-brain/core-agents-plugin";
import {
  CORE_PLUGIN_MANIFEST_V2,
  CORE_REVIEWED_MODELS_V2
} from "@second-brain/core-agents-plugin/manifest";
import {
  INSTALLED_LOCAL_TOOL_FACTORY_IDS_V2,
  INSTALLED_PLUGIN_BROKER_PROVIDER_IDS_V2,
  INSTALLED_PLUGIN_MANIFESTS_V2,
  installedRuntimeClassesV2
} from "@second-brain/installed-plugins/catalog";
import { compilePlatformCatalogV2 } from "./compiler/platform-catalog-compiler.js";

const BROWSER_PLUGIN_MANIFEST_V2 = INSTALLED_PLUGIN_MANIFESTS_V2.find(
  ({ id }) => id === "browser"
)!;

const image = (hex: string) => `sha256:${hex.repeat(64)}`;

describe("core plugin V2 fixture", () => {
  it("loads through the public SDK package contract", () => {
    expect(CORE_PLUGIN.manifest.id).toBe("core-agents");
  });

  it("declares the complete installed agent and tool composition", () => {
    const manifests = [CORE_PLUGIN_MANIFEST_V2, BROWSER_PLUGIN_MANIFEST_V2];
    const agents = manifests.flatMap((manifest) => manifest.agents);
    expect(agents.map((agent) => agent.id)).toEqual([
      "brain",
      "orchestrator",
      "router",
      "document-analyzer",
      "scheduler",
      "browser"
    ]);
    expect(
      BROWSER_PLUGIN_MANIFEST_V2.agents.find(({ id }) => id === "browser")?.capabilityIds
    ).not.toContain("pi-bash");
    expect(
      BROWSER_PLUGIN_MANIFEST_V2.agents.find(({ id }) => id === "browser")?.capabilityIds
    ).toContain("browser-mutation");
    expect(
      BROWSER_PLUGIN_MANIFEST_V2.brokerProviders
        .find(({ id }) => id === "browser-mutation-provider")
        ?.operations.map(({ toolName }) => toolName)
    ).toEqual(["browser_click", "browser_type"]);
  });

  it("budgets every installed agent at 800,000 tokens under a 1,000,000-token runtime ceiling", () => {
    for (const manifest of INSTALLED_PLUGIN_MANIFESTS_V2) {
      for (const agent of manifest.agents) {
        expect(agent.tokenBudget, `${manifest.id}/${agent.id}`).toBe(800_000);
      }
    }
    for (const runtime of installedRuntimeClassesV2({
      base: image("a"),
      browser: image("b"),
      isolated: image("c")
    })) {
      expect(runtime.resourceCeiling.tokenBudget, runtime.id).toBe(1_000_000);
    }
  });

  it("resolves every role resource from the reviewed profile release inputs", () => {
    const profileRoot = join(process.cwd(), "deploy/pi-runtime");
    const acceptedResources = new Set(
      readFileSync(join(profileRoot, "accepted-resources.txt"), "utf8").split("\n").filter(Boolean)
    );

    for (const manifest of INSTALLED_PLUGIN_MANIFESTS_V2) {
      for (const agent of manifest.agents) {
        for (const path of [agent.promptPath, ...agent.skillPaths, ...agent.extensionPaths]) {
          expect(acceptedResources.has(path), `${path} is absent from accepted-resources.txt`).toBe(
            true
          );
          const hasSource = INSTALLED_PLUGIN_MANIFESTS_V2.some((candidate) =>
            existsSync(join(process.cwd(), "plugins", candidate.id, "resources", path))
          );
          expect(hasSource, `${path} has no reviewed release source`).toBe(true);
        }
      }
    }
  });

  it("compiles with synthetic resources and real implementation ID inventories", () => {
    const files = new Map<string, string>();
    for (const agent of INSTALLED_PLUGIN_MANIFESTS_V2.flatMap((manifest) => manifest.agents)) {
      files.set(agent.promptPath, "reviewed prompt");
      for (const root of agent.skillPaths) files.set(`${root}/SKILL.md`, "reviewed skill");
      for (const path of agent.extensionPaths) files.set(path, "reviewed extension");
    }
    const catalog = compilePlatformCatalogV2({
      plugins: INSTALLED_PLUGIN_MANIFESTS_V2.map((manifest) => ({ manifest, files })),
      runtimeClasses: installedRuntimeClassesV2({
        base: image("a"),
        browser: image("b"),
        isolated: image("c")
      }),
      reviewedModels: [...CORE_REVIEWED_MODELS_V2],
      localToolFactoryIds: [...INSTALLED_LOCAL_TOOL_FACTORY_IDS_V2],
      brokerProviderIds: [...INSTALLED_PLUGIN_BROKER_PROVIDER_IDS_V2]
    });
    expect(catalog.agents).toHaveLength(7);
    expect(new Set(catalog.capabilities.flatMap((capability) => capability.toolIds)).size).toBe(27);
    expect(catalog.plugins).toHaveLength(3);
    expect(catalog.plugins.find(({ id }) => id === "example-echo")?.activation).toBe("workspace");
    expect(catalog.agents.find(({ id }) => id === "echo")?.pluginId).toBe("example-echo");
    expect(catalog.capabilities.find(({ capabilityId }) => capabilityId === "echo")).toMatchObject({
      pluginId: "example-echo",
      implementationId: "example-echo-tools",
      providerKind: "local",
      toolIds: ["echo"]
    });
    expect(catalog.plugins.find(({ id }) => id === "browser")?.activation).toBe("workspace");
  });

  it("requires approval and idempotency evidence for every external side effect", () => {
    const operations = INSTALLED_PLUGIN_MANIFESTS_V2.flatMap((manifest) =>
      manifest.brokerProviders.flatMap((provider) =>
        provider.operations.map((operation) => ({
          pluginId: manifest.id,
          providerId: provider.id,
          ...operation
        }))
      )
    );
    const external = operations.filter(({ sideEffect }) =>
      ["external", "destructive"].includes(sideEffect)
    );
    expect(external.length).toBeGreaterThan(0);
    expect(
      external.map(({ pluginId, providerId, id, approvalPolicy, idempotencyPolicy }) => ({
        pluginId,
        providerId,
        id,
        approvalPolicy,
        idempotencyPolicy
      }))
    ).toEqual(
      external.map(({ pluginId, providerId, id }) => ({
        pluginId,
        providerId,
        id,
        approvalPolicy: "owner",
        idempotencyPolicy: "required"
      }))
    );
  });
});
