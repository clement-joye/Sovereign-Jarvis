import { describe, expect, it } from "vitest";
import type { PluginManifestV2 } from "@second-brain/contracts";
import {
  PLUGIN_API_SCHEMA_REVISION,
  PLUGIN_MANIFEST_SCHEMA_VERSION,
  PLUGIN_SDK_COMPATIBILITY,
  PLUGIN_SDK_MAJOR_VERSION,
  PLUGIN_SDK_VERSION,
  assertPluginContract,
  assertPluginSdkCompatibility,
  definePiToolProvider,
  definePlugin,
  definePluginPackage
} from "./index.js";
import * as publicSdk from "./index.js";

const manifest = {
  schemaVersion: 2,
  id: "echo",
  displayName: "Echo",
  activation: "workspace",
  agents: [],
  localToolProviders: [],
  brokerProviders: [],
  runtimeFeatures: [{ id: "echo" }]
} satisfies PluginManifestV2;

describe("plugin SDK", () => {
  it("freezes the v1 public runtime surface and compatibility revisions", () => {
    expect(PLUGIN_SDK_VERSION).toBe("1.0.0");
    expect(PLUGIN_SDK_COMPATIBILITY).toEqual({
      sdkMajorVersion: PLUGIN_SDK_MAJOR_VERSION,
      manifestSchemaVersion: PLUGIN_MANIFEST_SCHEMA_VERSION,
      pluginApiSchemaRevision: PLUGIN_API_SCHEMA_REVISION
    });
    expect(Object.isFrozen(PLUGIN_SDK_COMPATIBILITY)).toBe(true);
    expect(Object.keys(publicSdk).sort()).toEqual([
      "PLUGIN_API_SCHEMA_REVISION",
      "PLUGIN_MANIFEST_SCHEMA_VERSION",
      "PLUGIN_SDK_COMPATIBILITY",
      "PLUGIN_SDK_MAJOR_VERSION",
      "PLUGIN_SDK_VERSION",
      "assertPluginContract",
      "assertPluginSdkCompatibility",
      "definePiToolProvider",
      "definePlugin",
      "definePluginPackage"
    ]);
  });

  it("rejects every incompatible SDK, manifest, or release API revision", () => {
    assertPluginSdkCompatibility(PLUGIN_SDK_COMPATIBILITY);
    for (const field of Object.keys(PLUGIN_SDK_COMPATIBILITY)) {
      expect(() =>
        assertPluginSdkCompatibility({
          ...PLUGIN_SDK_COMPATIBILITY,
          [field]: PLUGIN_SDK_COMPATIBILITY[field as keyof typeof PLUGIN_SDK_COMPATIBILITY] + 1
        })
      ).toThrow(`Incompatible plugin ${field}`);
    }
  });

  it("validates and freezes manifests/providers", () => {
    const value = definePlugin(manifest);
    expect(Object.isFrozen(value)).toBe(true);
    expect(
      Object.isFrozen(definePiToolProvider({ implementationId: "echo", create: () => [] }))
    ).toBe(true);
  });
  it("checks provider closure and duplicate IDs", () => {
    expect(() =>
      assertPluginContract({
        manifest,
        providers: [
          { implementationId: "x", create: () => [] },
          { implementationId: "x", create: () => [] }
        ]
      })
    ).toThrow("Duplicate");
    expect(() =>
      assertPluginContract({
        manifest,
        providers: [{ implementationId: "undeclared", create: () => [] }]
      })
    ).toThrow("Undeclared");
  });
  it("defines a validated plugin package", () => {
    const pkg = definePluginPackage({ manifest });
    expect(pkg.manifest.id).toBe("echo");
    expect(pkg.brokerHandlerFactories).toEqual([]);
    expect(pkg.privilegedHandlerFactories).toEqual([]);
  });
});
