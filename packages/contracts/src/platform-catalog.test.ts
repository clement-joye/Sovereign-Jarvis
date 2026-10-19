import { describe, expect, it } from "vitest";
import { PlatformCatalogV2Schema, PluginManifestV2Schema } from "./platform-catalog.js";

const digest = `sha256:${"a".repeat(64)}`;

const agent = {
  id: "assistant",
  defaultForWorkspace: true,
  runtimeClass: "restricted",
  promptPath: "assistant/AGENTS.md",
  skillPaths: ["assistant/skills/core"],
  extensionPaths: [],
  capabilityIds: ["workspace-read"],
  runtimeFeatureIds: [],
  workspaceAccess: "read",
  threadContextPolicy: "fresh_session_with_thread_history",
  timeoutSeconds: 300,
  tokenBudget: 50_000,
  maxConcurrentRunsPerWorkspace: 2
} as const;

const manifest = {
  schemaVersion: 2,
  id: "core-agents",
  displayName: "Core agents",
  activation: "built-in",
  agents: [agent],
  localToolProviders: [],
  brokerProviders: [],
  runtimeFeatures: []
} as const;

const catalog = {
  schemaVersion: 2,
  digest,
  runtimeClasses: [
    {
      id: "restricted",
      image: `sha256:${"b".repeat(64)}`,
      mountPolicy: "read-only",
      networkPolicy: "restricted",
      featureIds: [],
      resourceCeiling: {
        timeoutSeconds: 600,
        tokenBudget: 100_000,
        maxConcurrentRuns: 4,
        memoryMiB: 4096,
        cpuMillicores: 4000,
        pids: 128,
        maxOutputBytes: 1_000_000
      }
    }
  ],
  plugins: [
    {
      id: "core-agents",
      displayName: "Core agents",
      activation: "built-in",
      contentDigest: digest,
      agentIds: ["assistant"],
      configurationSchema: {},
      operations: []
    }
  ],
  agents: [{ ...agent, pluginId: "core-agents", definitionDigest: digest }],
  capabilities: [
    {
      capabilityId: "workspace-read",
      pluginId: "core-agents",
      providerId: "workspace-local",
      implementationId: "workspace-tools",
      definitionDigest: digest,
      providerKind: "local",
      toolIds: ["workspace_read"],
      filesystem: "read-only",
      process: "none",
      network: "none",
      sideEffect: "none"
    }
  ],
  runtimeFeatures: [],
  reviewedModels: [{ providerId: "local", modelId: "small" }]
} as const;

describe("platform catalog v2 contracts", () => {
  it("parses a plugin and compiled catalog with stable digests", () => {
    expect(PluginManifestV2Schema.parse(manifest)).toEqual(manifest);
    expect(PlatformCatalogV2Schema.parse(catalog)).toEqual(catalog);
  });

  it("rejects independent semantic versions", () => {
    expect(() => PluginManifestV2Schema.parse({ ...manifest, version: "1.0.0" })).toThrow();
    expect(() => PlatformCatalogV2Schema.parse({ ...catalog, catalogVersion: "1.0.0" })).toThrow();
  });

  it("rejects credentials and secret-valued configuration fields", () => {
    expect(() =>
      PluginManifestV2Schema.parse({ ...manifest, credential: "github-token-value" })
    ).toThrow();
    expect(() =>
      PluginManifestV2Schema.parse({
        ...manifest,
        agents: [],
        brokerProviders: [
          {
            id: "remote",
            capabilityId: "remote-api",
            providerId: "broker",
            credentialKind: "github-token",
            configurationSchema: { api_token: "string" },
            operations: [
              {
                id: "read",
                toolName: "remote_read",
                sideEffect: "none",
                approvalPolicy: "none",
                idempotencyPolicy: "not-applicable"
              }
            ]
          }
        ]
      })
    ).toThrow();
  });

  it("rejects absolute and traversal resource paths", () => {
    expect(() =>
      PluginManifestV2Schema.parse({
        ...manifest,
        agents: [{ ...agent, promptPath: "../AGENTS.md" }]
      })
    ).toThrow();
    expect(() =>
      PluginManifestV2Schema.parse({
        ...manifest,
        agents: [{ ...agent, promptPath: "/etc/AGENTS.md" }]
      })
    ).toThrow();
  });

  it("requires at least one plugin contribution", () => {
    expect(() =>
      PluginManifestV2Schema.parse({
        ...manifest,
        agents: [],
        localToolProviders: [],
        brokerProviders: [],
        runtimeFeatures: []
      })
    ).toThrow("at least one");
  });

  it("requires durable approval and idempotency for brokered mutations", () => {
    const operation = {
      id: "push",
      toolName: "git_push",
      sideEffect: "external",
      approvalPolicy: "none",
      idempotencyPolicy: "optional"
    } as const;
    expect(() =>
      PluginManifestV2Schema.parse({
        ...manifest,
        agents: [],
        brokerProviders: [
          {
            id: "git-broker",
            capabilityId: "sample-repository",
            providerId: "git-handler",
            credentialKind: "github-token",
            configurationSchema: {},
            operations: [operation]
          }
        ]
      })
    ).toThrow("owner approval");
    expect(() =>
      PluginManifestV2Schema.parse({
        ...manifest,
        agents: [],
        brokerProviders: [
          {
            id: "git-broker",
            capabilityId: "sample-repository",
            providerId: "git-handler",
            credentialKind: "github-token",
            configurationSchema: {},
            operations: [{ ...operation, approvalPolicy: "owner" }]
          }
        ]
      })
    ).toThrow("idempotency");
  });

  it("requires runtime-class feature references to resolve", () => {
    expect(() =>
      PlatformCatalogV2Schema.parse({
        ...catalog,
        runtimeClasses: [{ ...catalog.runtimeClasses[0], featureIds: ["missing-feature"] }]
      })
    ).toThrow("Unknown runtime class feature");
  });
});
