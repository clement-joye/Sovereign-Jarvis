import { createHash } from "node:crypto";

import {
  EffectiveRunPolicyV2Schema,
  type CompiledCapabilityProviderV2,
  type EffectiveRunPolicyV2,
  type PlatformCatalogV2
} from "@second-brain/contracts";

import type { WorkspacePluginBindingRepositoryPort } from "../ports.js";

type ActiveBinding = Awaited<ReturnType<WorkspacePluginBindingRepositoryPort["get"]>>;

export interface EffectiveRunPolicyCatalog {
  readonly catalog: Readonly<PlatformCatalogV2>;
  getAgent(id: string): PlatformCatalogV2["agents"][number] | undefined;
  getCapability(id: string): CompiledCapabilityProviderV2 | undefined;
  getPlugin(id: string): PlatformCatalogV2["plugins"][number] | undefined;
  getRuntimeClass(id: string): PlatformCatalogV2["runtimeClasses"][number] | undefined;
}

export interface EffectiveRunPolicyInput {
  workspaceId: string;
  agentId: string;
  /** Runtime deployment ceiling; omission means the reviewed catalog ceiling. */
  runtimeAllowedTools?: readonly string[];
  /** Delegation/run ceiling; omission means the reviewed catalog ceiling. */
  delegatedToolPolicy?: readonly string[];
}

/**
 * Resolves one immutable run snapshot by intersection only. Built-in plugins
 * are active from the release; workspace plugins require a binding that names
 * the effective agent, and credentialed capabilities require a credential ref.
 */
export class EffectiveRunPolicyResolver {
  constructor(
    private readonly catalog: EffectiveRunPolicyCatalog,
    private readonly bindings: Pick<WorkspacePluginBindingRepositoryPort, "get">
  ) {}

  async resolve(input: EffectiveRunPolicyInput): Promise<EffectiveRunPolicyV2> {
    const agent = this.catalog.getAgent(input.agentId);
    if (!agent) throw new Error(`Unknown agent in active platform catalog: ${input.agentId}.`);
    const agentBinding = await this.activeBinding(input.workspaceId, input.agentId, agent.pluginId);
    if (this.requirePlugin(agent.pluginId).activation === "workspace" && !agentBinding) {
      throw new Error(
        `Agent plugin is disabled for this workspace: ${agent.pluginId}/${input.agentId}.`
      );
    }
    this.requireAgentPluginCredentials(agent, agentBinding);
    return this.resolveActive(input, agent, new Map([[agent.pluginId, agentBinding]]));
  }

  /** Router discovery omits disabled plugin agents without weakening explicit selection. */
  async resolveIfActive(input: EffectiveRunPolicyInput): Promise<EffectiveRunPolicyV2 | undefined> {
    const agent = this.catalog.getAgent(input.agentId);
    if (!agent) throw new Error(`Unknown agent in active platform catalog: ${input.agentId}.`);
    const plugin = this.requirePlugin(agent.pluginId);
    const agentBinding = await this.activeBinding(input.workspaceId, input.agentId, agent.pluginId);
    if (plugin.activation === "workspace" && !agentBinding) return undefined;
    this.requireAgentPluginCredentials(agent, agentBinding);
    return this.resolveActive(input, agent, new Map([[agent.pluginId, agentBinding]]));
  }

  private async resolveActive(
    input: EffectiveRunPolicyInput,
    agent: PlatformCatalogV2["agents"][number],
    activeBindings: Map<string, ActiveBinding>
  ): Promise<EffectiveRunPolicyV2> {
    const capabilities: CompiledCapabilityProviderV2[] = [];
    for (const capabilityId of agent.capabilityIds) {
      const capability = this.catalog.getCapability(capabilityId);
      if (!capability) throw new Error(`Missing reviewed capability: ${capabilityId}.`);
      const binding = await this.cachedActiveBinding(
        activeBindings,
        input.workspaceId,
        input.agentId,
        capability.pluginId
      );
      const plugin = this.requirePlugin(capability.pluginId);
      if (plugin.activation === "workspace" && !binding) continue;
      if (
        capability.providerKind === "broker" &&
        capability.credentialKind &&
        !binding?.credentialRef
      )
        continue;
      capabilities.push(capability);
    }

    const runtimeTools = input.runtimeAllowedTools ? new Set(input.runtimeAllowedTools) : undefined;
    const delegatedTools = input.delegatedToolPolicy
      ? new Set(input.delegatedToolPolicy)
      : undefined;
    const toolIds = [
      ...new Set(
        capabilities
          .flatMap((capability) => capability.toolIds)
          .filter(
            (tool) =>
              (!runtimeTools || runtimeTools.has(tool)) &&
              (!delegatedTools || delegatedTools.has(tool))
          )
      )
    ].sort();
    const capabilityIds = capabilities
      .filter((capability) => capability.toolIds.some((tool) => toolIds.includes(tool)))
      .map((capability) => capability.capabilityId)
      .sort();
    const pluginIds = [
      ...new Set([
        agent.pluginId,
        ...capabilities
          .filter((capability) => capabilityIds.includes(capability.capabilityId))
          .map((capability) => capability.pluginId)
      ])
    ].sort();
    const platformPolicyDigest = this.catalog.catalog.policyDigest;
    const resourceDigest = this.catalog.catalog.resourceDigest;
    if (!platformPolicyDigest || !resourceDigest) {
      throw new Error("Active platform catalog is missing execution identity projections.");
    }
    const runtimeClass = this.catalog.getRuntimeClass(agent.runtimeClass);
    if (!runtimeClass) {
      throw new Error(`Missing reviewed runtime class: ${agent.runtimeClass}.`);
    }
    const content = {
      schemaVersion: 2 as const,
      catalogDigest: this.catalog.catalog.digest,
      platformPolicyDigest,
      resourceDigest,
      runtimeImageId: runtimeClass.image,
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      pluginIds,
      capabilityIds,
      toolIds,
      skillPaths: [...agent.skillPaths].sort(),
      extensionPaths: [...agent.extensionPaths].sort()
    };
    return EffectiveRunPolicyV2Schema.parse({
      ...content,
      policyDigest: `sha256:${createHash("sha256").update(JSON.stringify(content)).digest("hex")}`
    });
  }

  private requirePlugin(pluginId: string): PlatformCatalogV2["plugins"][number] {
    const plugin = this.catalog.getPlugin(pluginId);
    if (!plugin) throw new Error(`Missing reviewed plugin: ${pluginId}.`);
    return plugin;
  }

  private requireAgentPluginCredentials(
    agent: PlatformCatalogV2["agents"][number],
    binding: ActiveBinding
  ): void {
    const credentialRequired = agent.capabilityIds.some((capabilityId) => {
      const capability = this.catalog.getCapability(capabilityId);
      return (
        capability?.pluginId === agent.pluginId &&
        capability.providerKind === "broker" &&
        capability.credentialKind !== undefined
      );
    });
    if (credentialRequired && !binding?.credentialRef) {
      throw new Error(`Plugin credential binding is missing: ${agent.pluginId}/${agent.id}.`);
    }
  }

  private async cachedActiveBinding(
    cache: Map<string, ActiveBinding>,
    workspaceId: string,
    agentId: string,
    pluginId: string
  ): Promise<ActiveBinding> {
    if (cache.has(pluginId)) return cache.get(pluginId);
    const binding = await this.activeBinding(workspaceId, agentId, pluginId);
    cache.set(pluginId, binding);
    return binding;
  }

  private async activeBinding(workspaceId: string, agentId: string, pluginId: string) {
    const plugin = this.requirePlugin(pluginId);
    if (plugin.activation === "built-in") return undefined;
    const binding = await this.bindings.get(workspaceId, pluginId);
    return binding?.enabledAgents.includes(agentId) ? binding : undefined;
  }
}
