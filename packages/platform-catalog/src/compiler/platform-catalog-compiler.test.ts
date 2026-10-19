import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type {
  PlatformCatalogV2,
  PluginManifestV2,
  RuntimeClassPinV2
} from "@second-brain/contracts/platform-catalog";

import {
  compilePlatformCatalogV2,
  platformCatalogDigestV2,
  type PlatformCatalogCompilerInput,
  type PluginPackageV2
} from "./platform-catalog-compiler.js";
import { buildProfileResourceBundle } from "../../../../scripts/runtime/build-profile-resource-bundle.mjs";

describe("platform catalog compiler", () => {
  it("compiles one closed immutable catalog with canonical digests", () => {
    const catalog = compilePlatformCatalogV2(validInput());
    const { digest, ...content } = catalog;

    expect(digest).toBe(platformCatalogDigestV2(content));
    expect(catalog.policyDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(catalog.resourceDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(catalog.plugins).toEqual([
      {
        id: "core",
        displayName: "Core",
        activation: "workspace",
        contentDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        agentIds: ["assistant"],
        configurationSchema: {},
        operations: [
          {
            id: "workspace-read",
            toolName: "workspace_read",
            approvalPolicy: "none"
          }
        ]
      }
    ]);
    expect(catalog.agents[0]).toMatchObject({
      id: "assistant",
      pluginId: "core",
      definitionDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
    });
    expect(catalog.capabilities[0]).toMatchObject({
      capabilityId: "workspace-read",
      pluginId: "core",
      providerKind: "local",
      implementationId: "workspace-tools",
      toolIds: ["workspace_read"]
    });
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.agents)).toBe(true);
    expect(Object.isFrozen(catalog.agents[0]?.capabilityIds)).toBe(true);
  });

  it("binds the catalog resource digest to the published role resource bundle", async () => {
    const input = validInput();
    const plugin = input.plugins[0];
    if (!plugin) throw new Error("Missing test plugin.");
    const root = await mkdtemp(join(tmpdir(), "platform-catalog-resource-digest-"));
    const profileRoot = join(root, "profile");
    const pluginsRoot = join(root, "plugins");
    const outputRoot = join(root, "runtime-profile");
    try {
      await mkdir(profileRoot, { recursive: true });
      await mkdir(join(pluginsRoot, plugin.manifest.id, "resources/assistant/skills/core"), {
        recursive: true
      });
      await writeFile(
        join(profileRoot, "accepted-resources.txt"),
        "assistant/AGENTS.md\nassistant/skills\n"
      );
      await writeFile(
        join(profileRoot, "classification.json"),
        JSON.stringify({
          resources: {
            "assistant/AGENTS.md": { compatibility: "sdk-compatible" },
            "assistant/skills": { compatibility: "sdk-compatible" }
          }
        })
      );
      for (const [path, content] of plugin.files) {
        const target = join(pluginsRoot, plugin.manifest.id, "resources", path);
        await mkdir(join(target, ".."), { recursive: true });
        await writeFile(target, content);
      }

      const catalog = compilePlatformCatalogV2(input);
      const bundle = await buildProfileResourceBundle({
        profileRoot,
        pluginsRoot,
        outputRoot
      });

      expect(bundle.digest).toBe(catalog.resourceDigest);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("is independent of package and runtime input ordering", () => {
    const input = validInput();
    const featurePlugin: PluginPackageV2 = {
      manifest: {
        schemaVersion: 2,
        id: "browser-feature",
        displayName: "Browser feature",
        activation: "workspace",
        agents: [],
        localToolProviders: [],
        brokerProviders: [],
        runtimeFeatures: [{ id: "chromium" }]
      },
      files: new Map()
    };
    const forward = compilePlatformCatalogV2({
      ...input,
      plugins: [...input.plugins, featurePlugin],
      runtimeClasses: [...input.runtimeClasses, browserRuntime()]
    });
    const reversed = compilePlatformCatalogV2({
      ...input,
      plugins: [featurePlugin, ...input.plugins],
      runtimeClasses: [browserRuntime(), ...input.runtimeClasses]
    });

    expect(reversed).toEqual(forward);
  });

  it("changes plugin and catalog identity when a referenced resource changes", () => {
    const original = validInput();
    const changed = validInput();
    changed.plugins[0]?.files.set("assistant/AGENTS.md", "Changed reviewed prompt.");

    const before = compilePlatformCatalogV2(original);
    const after = compilePlatformCatalogV2(changed);
    expect(after.plugins[0]?.contentDigest).not.toBe(before.plugins[0]?.contentDigest);
    expect(after.agents[0]?.definitionDigest).not.toBe(before.agents[0]?.definitionDigest);
    expect(after.digest).not.toBe(before.digest);
    expect(after.policyDigest).toBe(before.policyDigest);
    expect(after.resourceDigest).not.toBe(before.resourceDigest);
  });

  it("includes non-entrypoint package resources such as transitive imports in plugin identity", () => {
    const original = validInput();
    const changed = validInput();
    original.plugins[0]?.files.set("extensions/_shared/helper.ts", "export const value = 1;");
    changed.plugins[0]?.files.set("extensions/_shared/helper.ts", "export const value = 2;");

    const before = compilePlatformCatalogV2(original);
    const after = compilePlatformCatalogV2(changed);
    expect(after.plugins[0]?.contentDigest).not.toBe(before.plugins[0]?.contentDigest);
    expect(after.agents[0]?.definitionDigest).toBe(before.agents[0]?.definitionDigest);
    expect(after.digest).not.toBe(before.digest);
    expect(after.policyDigest).toBe(before.policyDigest);
    expect(after.resourceDigest).toBe(before.resourceDigest);
  });

  it("excludes runtime image identity from policy while retaining runtime ceilings", () => {
    const original = compilePlatformCatalogV2(validInput());
    const changed = validInput();
    const runtimeClass = changed.runtimeClasses[0];
    if (!runtimeClass) throw new Error("Expected a runtime class");
    changed.runtimeClasses[0] = {
      ...runtimeClass,
      image: `jarvis/runtime@sha256:${"b".repeat(64)}`
    };
    const imageChanged = compilePlatformCatalogV2(changed);
    expect(imageChanged.digest).not.toBe(original.digest);
    expect(imageChanged.policyDigest).toBe(original.policyDigest);

    changed.runtimeClasses[0] = {
      ...runtimeClass,
      resourceCeiling: {
        ...runtimeClass.resourceCeiling,
        memoryMiB: 2048
      }
    };
    expect(compilePlatformCatalogV2(changed).policyDigest).not.toBe(original.policyDigest);
  });

  it("rejects duplicate selected role resource output paths", () => {
    const input = validInput();
    const duplicate = pluginPackage();
    duplicate.manifest = {
      ...duplicate.manifest,
      id: "other",
      agents: [
        {
          ...duplicate.manifest.agents[0]!,
          id: "other-agent",
          defaultForWorkspace: false,
          capabilityIds: []
        }
      ],
      localToolProviders: []
    };
    expect(() =>
      compilePlatformCatalogV2({ ...input, plugins: [input.plugins[0]!, duplicate] })
    ).toThrow("Duplicate role resource output path: assistant/AGENTS.md");
  });

  it("rejects missing resources and unregistered provider implementations", () => {
    const missingPrompt = validInput();
    missingPrompt.plugins[0]?.files.delete("assistant/AGENTS.md");
    expect(() => compilePlatformCatalogV2(missingPrompt)).toThrow("prompt does not exist");

    expect(() => compilePlatformCatalogV2({ ...validInput(), localToolFactoryIds: [] })).toThrow(
      "unknown local tool factory"
    );
  });

  it("permits an explicitly unlimited agent only in an unlimited runtime", () => {
    const finiteRuntime = withAgent({ tokenBudget: "unlimited" });
    expect(() => compilePlatformCatalogV2(finiteRuntime)).toThrow(
      "exceeds its runtime token ceiling"
    );

    const unlimitedRuntime = withAgent({ tokenBudget: "unlimited" });
    unlimitedRuntime.runtimeClasses[0] = {
      ...unlimitedRuntime.runtimeClasses[0]!,
      resourceCeiling: {
        ...unlimitedRuntime.runtimeClasses[0]!.resourceCeiling,
        tokenBudget: "unlimited"
      }
    };
    expect(compilePlatformCatalogV2(unlimitedRuntime).agents[0]?.tokenBudget).toBe("unlimited");
  });

  it("rejects duplicate identities across plugin packages", () => {
    const input = validInput();
    const duplicate = pluginPackage();
    duplicate.manifest = { ...duplicate.manifest, id: "other" };
    expect(() =>
      compilePlatformCatalogV2({ ...input, plugins: [...input.plugins, duplicate] })
    ).toThrow("Duplicate agent id");
  });

  it("rejects unresolved agent capabilities, features, models, and delegation targets", () => {
    expect(() =>
      compilePlatformCatalogV2(withAgent({ capabilityIds: ["missing-capability"] }))
    ).toThrow("unknown capability");
    expect(() =>
      compilePlatformCatalogV2(withAgent({ runtimeFeatureIds: ["missing-feature"] }))
    ).toThrow("unknown runtime feature");
    expect(() =>
      compilePlatformCatalogV2(withAgent({ model: { providerId: "local", modelId: "missing" } }))
    ).toThrow("unreviewed model");
    expect(() =>
      compilePlatformCatalogV2(
        withAgent({
          delegation: {
            mayDelegateTo: ["missing-agent"],
            toolPolicyByAgent: { "missing-agent": [] },
            maxChildren: 1
          }
        })
      )
    ).toThrow("delegates to unknown agent");
  });

  it("rejects delegated tools that the target agent does not provide", () => {
    const input = validInput();
    const plugin = input.plugins[0];
    const parent = plugin?.manifest.agents[0];
    if (!plugin || !parent) throw new Error("Missing test agent.");
    const { defaultForWorkspace: _default, ...childBase } = parent;
    plugin.manifest = {
      ...plugin.manifest,
      agents: [
        {
          ...parent,
          delegation: {
            mayDelegateTo: ["child"],
            toolPolicyByAgent: { child: ["websearch"] },
            maxChildren: 1
          }
        },
        {
          ...childBase,
          id: "child",
          promptPath: "child/AGENTS.md",
          skillPaths: [],
          capabilityIds: []
        }
      ]
    };
    plugin.files.set("child/AGENTS.md", "Reviewed child prompt.");

    expect(() => compilePlatformCatalogV2(input)).toThrow(
      "delegates unavailable tool websearch to agent child"
    );
  });

  it("rejects a runtime feature that the selected runtime class does not provide", () => {
    const input = withAgent({ runtimeFeatureIds: ["chromium"] });
    const plugin = input.plugins[0];
    if (!plugin) throw new Error("Missing test plugin.");
    plugin.manifest = {
      ...plugin.manifest,
      runtimeFeatures: [{ id: "chromium" }]
    };

    expect(() => compilePlatformCatalogV2(input)).toThrow(
      "runtime class restricted does not provide feature: chromium"
    );
  });

  it("rejects agent and provider policy above the runtime ceiling", () => {
    expect(() => compilePlatformCatalogV2(withAgent({ timeoutSeconds: 601 }))).toThrow(
      "runtime timeout ceiling"
    );
    expect(() => compilePlatformCatalogV2(withAgent({ workspaceAccess: "write" }))).toThrow(
      "workspace mount ceiling"
    );

    const processInput = validInput();
    processInput.runtimeClasses[0] = {
      ...baseRuntime(),
      mountPolicy: "read-write"
    };
    const plugin = processInput.plugins[0];
    if (!plugin) throw new Error("Missing test plugin.");
    plugin.manifest = {
      ...plugin.manifest,
      localToolProviders: [
        {
          ...plugin.manifest.localToolProviders[0]!,
          filesystem: "none",
          process: "arbitrary"
        }
      ]
    };
    expect(() => compilePlatformCatalogV2(processInput)).toThrow("Arbitrary process capability");
  });
});

function validInput(): MutableCompilerInput {
  return {
    plugins: [pluginPackage()],
    runtimeClasses: [baseRuntime()],
    reviewedModels: [{ providerId: "local", modelId: "small" }],
    localToolFactoryIds: ["workspace-tools"],
    brokerProviderIds: []
  };
}

function withAgent(overrides: Partial<PluginManifestV2["agents"][number]>): MutableCompilerInput {
  const input = validInput();
  const plugin = input.plugins[0];
  const agent = plugin?.manifest.agents[0];
  if (!plugin || !agent) throw new Error("Missing test agent.");
  plugin.manifest = { ...plugin.manifest, agents: [{ ...agent, ...overrides }] };
  return input;
}

function pluginPackage(): MutablePluginPackage {
  return {
    manifest: {
      schemaVersion: 2,
      id: "core",
      displayName: "Core",
      activation: "workspace",
      agents: [
        {
          id: "assistant",
          defaultForWorkspace: true,
          runtimeClass: "restricted",
          promptPath: "assistant/AGENTS.md",
          skillPaths: ["assistant/skills"],
          extensionPaths: [],
          capabilityIds: ["workspace-read"],
          runtimeFeatureIds: [],
          workspaceAccess: "read",
          threadContextPolicy: "fresh_session_with_thread_history",
          model: { providerId: "local", modelId: "small" },
          timeoutSeconds: 300,
          tokenBudget: 50_000,
          maxConcurrentRunsPerWorkspace: 1
        }
      ],
      localToolProviders: [
        {
          id: "workspace-local",
          capabilityId: "workspace-read",
          factoryId: "workspace-tools",
          toolNames: ["workspace_read"],
          filesystem: "read-only",
          process: "none",
          network: "none",
          sideEffect: "none"
        }
      ],
      brokerProviders: [],
      runtimeFeatures: []
    },
    files: new Map([
      ["assistant/AGENTS.md", "Reviewed assistant prompt."],
      ["assistant/skills/core/SKILL.md", "Reviewed skill."]
    ])
  };
}

function baseRuntime(): RuntimeClassPinV2 {
  return {
    id: "restricted",
    image: `jarvis/runtime@sha256:${"a".repeat(64)}`,
    mountPolicy: "read-only",
    networkPolicy: "restricted",
    featureIds: [],
    resourceCeiling: {
      timeoutSeconds: 600,
      tokenBudget: 100_000,
      maxConcurrentRuns: 2,
      memoryMiB: 4096,
      cpuMillicores: 4000,
      pids: 128,
      maxOutputBytes: 1_000_000
    }
  };
}

function browserRuntime(): RuntimeClassPinV2 {
  return {
    ...baseRuntime(),
    id: "browser",
    mountPolicy: "none",
    networkPolicy: "browser-restricted",
    featureIds: ["chromium"]
  };
}

interface MutablePluginPackage extends PluginPackageV2 {
  manifest: PluginManifestV2;
  files: Map<string, string | Uint8Array>;
}

interface MutableCompilerInput extends PlatformCatalogCompilerInput {
  plugins: MutablePluginPackage[];
  runtimeClasses: RuntimeClassPinV2[];
  reviewedModels: PlatformCatalogV2["reviewedModels"];
  localToolFactoryIds: string[];
  brokerProviderIds: string[];
}
