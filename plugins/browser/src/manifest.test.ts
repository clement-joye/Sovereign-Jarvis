import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BROWSER_PLUGIN } from "./index.js";
import { BROWSER_PLUGIN_MANIFEST_V2, browserRuntimeClassV2 } from "./manifest.js";

describe("browser plugin", () => {
  it("owns its agent, capabilities, implementations, and isolated runtime policy", () => {
    expect(BROWSER_PLUGIN_MANIFEST_V2).toMatchObject({
      id: "browser",
      activation: "workspace",
      agents: [{ id: "browser", runtimeClass: "browser", workspaceAccess: "none" }]
    });
    expect(BROWSER_PLUGIN_MANIFEST_V2.agents[0]?.extensionPaths).toEqual([
      "extensions/browser/index.ts"
    ]);
    expect(
      BROWSER_PLUGIN.brokerHandlerFactories.map(({ implementationId }) => implementationId)
    ).toEqual(["browser-control"]);
    expect(
      BROWSER_PLUGIN.privilegedHandlerFactories.map(({ implementationId }) => implementationId)
    ).toEqual(["browser-control"]);
    expect(browserRuntimeClassV2(`sha256:${"a".repeat(64)}`)).toMatchObject({
      id: "browser",
      mountPolicy: "none",
      networkPolicy: "browser-restricted",
      featureIds: ["browser-automation"]
    });
  });

  it("contains every owned runtime resource", () => {
    const root = join(process.cwd(), "plugins/browser/resources");
    const [agent] = BROWSER_PLUGIN_MANIFEST_V2.agents;
    for (const path of [agent!.promptPath, ...agent!.skillPaths, "extensions/browser/index.ts"]) {
      expect(existsSync(join(root, path)), path).toBe(true);
    }
  });
});
