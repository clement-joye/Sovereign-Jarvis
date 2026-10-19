import { describe, expect, it, vi } from "vitest";

import { EffectiveRunPolicyResolver } from "./effective-run-policy.js";

describe("EffectiveRunPolicyResolver", () => {
  it("activates built-ins and an explicitly bound credentialed workspace capability", async () => {
    const get = vi.fn().mockResolvedValue({
      workspaceId: "workspace-1",
      pluginId: "calendar",
      pluginVersion: "1.0.0",
      enabledAgents: ["assistant"],
      configuration: {},
      credentialRef: "calendar-owner"
    });
    const resolver = new EffectiveRunPolicyResolver(catalog(), { get });

    const policy = await resolver.resolve({ workspaceId: "workspace-1", agentId: "assistant" });

    expect(policy).toMatchObject({
      platformPolicyDigest: digest("6"),
      resourceDigest: digest("7"),
      runtimeImageId: digest("8"),
      pluginIds: ["calendar", "core"],
      capabilityIds: ["calendar-events", "workspace-read"],
      toolIds: ["calendar_create", "workspace_read"]
    });
    expect(policy.policyDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("omits disabled, wrong-agent, and credential-missing workspace capabilities", async () => {
    const resolver = new EffectiveRunPolicyResolver(catalog(), {
      get: vi.fn().mockResolvedValue({
        workspaceId: "workspace-1",
        pluginId: "calendar",
        pluginVersion: "1.0.0",
        enabledAgents: ["other-agent"],
        configuration: {}
      })
    });

    await expect(
      resolver.resolve({ workspaceId: "workspace-1", agentId: "assistant" })
    ).resolves.toMatchObject({
      pluginIds: ["core"],
      capabilityIds: ["workspace-read"],
      toolIds: ["workspace_read"]
    });
  });

  it("intersects runtime and delegated ceilings without expanding either", async () => {
    const resolver = new EffectiveRunPolicyResolver(catalog(), {
      get: vi.fn().mockResolvedValue(undefined)
    });
    const policy = await resolver.resolve({
      workspaceId: "workspace-1",
      agentId: "assistant",
      runtimeAllowedTools: ["workspace_read", "undeclared_tool"],
      delegatedToolPolicy: ["workspace_read", "calendar_create", "undeclared_tool"]
    });

    expect(policy.toolIds).toEqual(["workspace_read"]);
    expect(policy.capabilityIds).toEqual(["workspace-read"]);
  });

  it("fails closed when the plugin that contributes the agent is disabled", async () => {
    const value = catalog();
    value.catalog.agents[0] = { ...value.catalog.agents[0]!, pluginId: "calendar" };
    const resolver = new EffectiveRunPolicyResolver(value, {
      get: vi.fn().mockResolvedValue(undefined)
    });

    await expect(
      resolver.resolve({ workspaceId: "workspace-1", agentId: "assistant" })
    ).rejects.toThrow(/disabled/i);
    await expect(
      resolver.resolveIfActive({ workspaceId: "workspace-1", agentId: "assistant" })
    ).resolves.toBeUndefined();
  });

  it("fails before a plugin agent runs when its required credential is missing", async () => {
    const value = catalog();
    value.catalog.agents[0] = { ...value.catalog.agents[0]!, pluginId: "calendar" };
    const resolver = new EffectiveRunPolicyResolver(value, {
      get: vi.fn().mockResolvedValue({
        workspaceId: "workspace-1",
        pluginId: "calendar",
        pluginVersion: "1.0.0",
        enabledAgents: ["assistant"],
        configuration: {}
      })
    });

    await expect(
      resolver.resolve({ workspaceId: "workspace-1", agentId: "assistant" })
    ).rejects.toThrow(/credential binding is missing/i);
  });

  it("reflects a revoked workspace binding on the next resolution", async () => {
    const value = catalog();
    value.catalog.agents[0] = { ...value.catalog.agents[0]!, pluginId: "calendar" };
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        workspaceId: "workspace-1",
        pluginId: "calendar",
        pluginVersion: "1.0.0",
        enabledAgents: ["assistant"],
        configuration: {},
        credentialRef: "calendar-owner"
      })
      .mockResolvedValue(undefined);
    const resolver = new EffectiveRunPolicyResolver(value, { get });

    await expect(
      resolver.resolve({ workspaceId: "workspace-1", agentId: "assistant" })
    ).resolves.toBeDefined();
    await expect(
      resolver.resolveIfActive({ workspaceId: "workspace-1", agentId: "assistant" })
    ).resolves.toBeUndefined();
  });

  it("fails closed when execution identity projections are absent", async () => {
    const value = catalog();
    Reflect.deleteProperty(value.catalog, "policyDigest");
    const resolver = new EffectiveRunPolicyResolver(value, {
      get: vi.fn().mockResolvedValue(undefined)
    });

    await expect(
      resolver.resolve({ workspaceId: "workspace-1", agentId: "assistant" })
    ).rejects.toThrow(/missing execution identity projections/i);
  });
});

function catalog() {
  const plugins = [
    { id: "core", activation: "built-in", contentDigest: digest("1") },
    { id: "calendar", activation: "workspace", contentDigest: digest("2") }
  ] as const;
  const capabilities = [
    {
      capabilityId: "workspace-read",
      pluginId: "core",
      providerId: "workspace-read-provider",
      implementationId: "workspace-tools",
      definitionDigest: digest("3"),
      providerKind: "local" as const,
      toolIds: ["workspace_read"],
      filesystem: "read-only" as const,
      process: "none" as const,
      network: "none" as const,
      sideEffect: "none" as const
    },
    {
      capabilityId: "calendar-events",
      pluginId: "calendar",
      providerId: "calendar-provider",
      implementationId: "calendar-control",
      definitionDigest: digest("4"),
      providerKind: "broker" as const,
      toolIds: ["calendar_create"],
      credentialKind: "calendar-token",
      configurationSchema: {},
      operations: [
        {
          id: "calendar-create",
          toolName: "calendar_create",
          sideEffect: "external" as const,
          approvalPolicy: "owner" as const,
          idempotencyPolicy: "required" as const
        }
      ]
    }
  ];
  const catalog = {
    schemaVersion: 2 as const,
    digest: digest("0"),
    policyDigest: digest("6"),
    resourceDigest: digest("7"),
    plugins: [...plugins],
    agents: [
      {
        id: "assistant",
        pluginId: "core",
        definitionDigest: digest("5"),
        runtimeClass: "base",
        promptPath: "assistant/AGENTS.md",
        skillPaths: ["assistant/skills"],
        extensionPaths: ["extensions/core.ts"],
        capabilityIds: ["workspace-read", "calendar-events"],
        runtimeFeatureIds: [],
        workspaceAccess: "read" as const,
        threadContextPolicy: "reuse_session" as const,
        timeoutSeconds: 60,
        tokenBudget: 1_000,
        maxConcurrentRunsPerWorkspace: 1
      }
    ],
    capabilities,
    runtimeClasses: [
      {
        id: "base",
        image: digest("8"),
        mountPolicy: "scoped-write" as const,
        networkPolicy: "restricted" as const,
        featureIds: [],
        resourceCeiling: {
          timeoutSeconds: 60,
          tokenBudget: 1_000,
          maxConcurrentRuns: 1,
          memoryMiB: 1_024,
          cpuMillicores: 1_000,
          pids: 128,
          maxOutputBytes: 100_000
        }
      }
    ],
    runtimeFeatures: [],
    reviewedModels: []
  };
  return {
    catalog,
    getAgent: (id: string) => catalog.agents.find((agent) => agent.id === id),
    getCapability: (id: string) =>
      catalog.capabilities.find((capability) => capability.capabilityId === id),
    getPlugin: (id: string) => catalog.plugins.find((plugin) => plugin.id === id),
    getRuntimeClass: (id: string) =>
      catalog.runtimeClasses.find((runtimeClass) => runtimeClass.id === id)
  } as never as ConstructorParameters<typeof EffectiveRunPolicyResolver>[0];
}

function digest(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}
