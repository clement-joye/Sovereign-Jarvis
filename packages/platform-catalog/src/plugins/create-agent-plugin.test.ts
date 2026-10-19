import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  PluginManifestV2Schema,
  type PluginManifestV2
} from "@second-brain/contracts/platform-catalog";
import {
  installedRuntimeClassesV2,
  INSTALLED_LOCAL_TOOL_FACTORY_IDS_V2,
  INSTALLED_PLUGIN_BROKER_PROVIDER_IDS_V2,
  INSTALLED_PLUGIN_MANIFESTS_V2,
  INSTALLED_REVIEWED_MODELS_V2
} from "@second-brain/installed-plugins/catalog";
import { describe, expect, it } from "vitest";

import { createAgentPlugin } from "../../../../scripts/plugins/create-agent-plugin.mjs";
import { compilePlatformCatalogV2 } from "../compiler/platform-catalog-compiler.js";

describe("agent:new", () => {
  it("creates a safe agent package and sorted installed composition entry without central code edits", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-new-"));
    try {
      await mkdir(join(root, "plugins"), { recursive: true });
      await writeFile(
        join(root, "plugins/agents.lock.json"),
        `${JSON.stringify({ schemaVersion: 1, agents: [] })}\n`
      );

      await createAgentPlugin("zeta", { root });

      const manifest = PluginManifestV2Schema.parse(
        JSON.parse(await readFile(join(root, "plugins/zeta/agent.manifest.json"), "utf8"))
      );
      expect(manifest.agents[0]).toMatchObject({
        id: "zeta",
        runtimeClass: "isolated",
        capabilityIds: [],
        tokenBudget: 800_000
      });
      const plugins = [...INSTALLED_PLUGIN_MANIFESTS_V2, manifest].map((pluginManifest) => ({
        manifest: pluginManifest,
        files: resourceFixture(pluginManifest)
      }));
      const catalog = compilePlatformCatalogV2({
        plugins,
        runtimeClasses: installedRuntimeClassesV2({
          base: image("a"),
          browser: image("b"),
          isolated: image("c")
        }),
        reviewedModels: [...INSTALLED_REVIEWED_MODELS_V2],
        localToolFactoryIds: [...INSTALLED_LOCAL_TOOL_FACTORY_IDS_V2],
        brokerProviderIds: [...INSTALLED_PLUGIN_BROKER_PROVIDER_IDS_V2]
      });
      expect(catalog.agents.map(({ id }) => id)).toContain("zeta");
      const lockValue: unknown = JSON.parse(
        await readFile(join(root, "plugins/agents.lock.json"), "utf8")
      );
      expect(readInstalledCompositionEntries(lockValue)).toEqual([
        { id: "zeta", manifest: "plugins/zeta/agent.manifest.json" }
      ]);
      await expect(
        access(join(root, "plugins/zeta/resources/zeta/skills/.gitkeep"))
      ).resolves.toBeUndefined();
      expect(await readFile(join(root, "plugins/zeta/README.md"), "utf8")).toContain(
        "# zeta agent plugin"
      );
      await expect(createAgentPlugin("zeta", { root })).rejects.toThrow("already exists");
      await expect(createAgentPlugin("Bad_ID", { root })).rejects.toThrow("lowercase");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function resourceFixture(manifest: PluginManifestV2) {
  const resources = new Map<string, string>();
  for (const agent of manifest.agents) {
    resources.set(agent.promptPath, `prompt:${agent.id}`);
    for (const path of agent.skillPaths) resources.set(`${path}/.gitkeep`, "");
    for (const path of agent.extensionPaths) resources.set(path, `extension:${agent.id}`);
  }
  return resources;
}

function image(character: string): string {
  return `sha256:${character.repeat(64)}`;
}

function readInstalledCompositionEntries(value: unknown): Array<{ id: string; manifest: string }> {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid agent lock fixture.");
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.agents)) throw new Error("Invalid agent lock fixture.");
  return record.agents.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("Invalid installed composition entry fixture.");
    }
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.manifest !== "string") {
      throw new Error("Invalid installed composition entry fixture.");
    }
    return { id: item.id, manifest: item.manifest };
  });
}
