import { describe, expect, it } from "vitest";

import { INSTALLED_PLUGIN_MANIFESTS_V2 } from "@second-brain/installed-plugins/catalog";
import { compileCorePlatformCatalogReleaseFromResources } from "@second-brain/platform-catalog";

import { PluginCatalog } from "./plugin-catalog.js";

describe("PluginCatalog", () => {
  it("uses the immutable compiled catalog as its only source", () => {
    const resources = new Map<string, string>();
    for (const agent of INSTALLED_PLUGIN_MANIFESTS_V2.flatMap(({ agents }) => agents)) {
      resources.set(agent.promptPath, "reviewed prompt");
      for (const path of agent.skillPaths) resources.set(`${path}/SKILL.md`, "reviewed skill");
      for (const path of agent.extensionPaths) resources.set(path, "reviewed extension");
    }
    const image = `sha256:${"a".repeat(64)}`;
    const compiled = compileCorePlatformCatalogReleaseFromResources(
      { base: image, isolated: image, browser: image },
      resources
    );
    const catalog = PluginCatalog.fromPlatformCatalog(compiled);

    expect(catalog.get("core-agents")?.activation).toBe("built-in");
    expect(catalog.get("example-echo")?.agentIds).toEqual(["echo"]);
    expect(catalog.get("browser")).toMatchObject({
      activation: "workspace",
      configurationSchema: {}
    });
    expect(catalog.get("browser")?.operations).toContainEqual({
      id: "browser-click",
      toolName: "browser_click",
      approvalPolicy: "owner"
    });
  });
});
