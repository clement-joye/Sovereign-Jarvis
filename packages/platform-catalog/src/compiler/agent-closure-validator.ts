import type {
  CompiledCapabilityProviderV2,
  PlatformCatalogV2,
  RuntimeClassPinV2
} from "@second-brain/contracts/platform-catalog";
import { tokenBudgetExceeds } from "@second-brain/contracts";

import { modelKey } from "./platform-catalog-digest.js";

interface AgentClosureInput {
  agents: PlatformCatalogV2["agents"];
  runtimeClassById: ReadonlyMap<string, RuntimeClassPinV2>;
  capabilities: readonly CompiledCapabilityProviderV2[];
  runtimeFeatureIds: ReadonlySet<string>;
  reviewedModelIds: ReadonlySet<string>;
}

type CompiledAgentV2 = PlatformCatalogV2["agents"][number];
type LocalCapabilityV2 = Extract<CompiledCapabilityProviderV2, { providerKind: "local" }>;

export function validateAgentClosure(input: AgentClosureInput): void {
  const agentIds = new Set(input.agents.map((agent) => agent.id));
  const capabilityById = new Map(
    input.capabilities.map((capability) => [capability.capabilityId, capability])
  );
  for (const agent of input.agents) {
    const runtimeClass = input.runtimeClassById.get(agent.runtimeClass);
    if (!runtimeClass)
      throw new Error(`Agent ${agent.id} has unknown runtime class: ${agent.runtimeClass}.`);
    validateAgentRuntimeCeilings(agent, runtimeClass);
    validateAgentReferences(agent, input, agentIds, runtimeClass);
    validateAgentCapabilities(agent, runtimeClass, capabilityById);
    validateDelegatedToolPolicies(agent, input.agents, capabilityById);
  }
}

function validateDelegatedToolPolicies(
  agent: CompiledAgentV2,
  agents: PlatformCatalogV2["agents"],
  capabilityById: ReadonlyMap<string, CompiledCapabilityProviderV2>
): void {
  for (const [childId, delegatedTools] of Object.entries(
    agent.delegation?.toolPolicyByAgent ?? {}
  )) {
    const child = agents.find((candidate) => candidate.id === childId);
    if (!child) continue;
    const childTools = new Set(
      child.capabilityIds.flatMap((capabilityId) => capabilityById.get(capabilityId)?.toolIds ?? [])
    );
    for (const tool of delegatedTools) {
      if (!childTools.has(tool))
        throw new Error(
          `Agent ${agent.id} delegates unavailable tool ${tool} to agent ${childId}.`
        );
    }
  }
}

function validateAgentRuntimeCeilings(
  agent: CompiledAgentV2,
  runtimeClass: RuntimeClassPinV2
): void {
  if (agent.timeoutSeconds > runtimeClass.resourceCeiling.timeoutSeconds)
    throw new Error(`Agent ${agent.id} exceeds its runtime timeout ceiling.`);
  if (tokenBudgetExceeds(agent.tokenBudget, runtimeClass.resourceCeiling.tokenBudget))
    throw new Error(`Agent ${agent.id} exceeds its runtime token ceiling.`);
  if (agent.maxConcurrentRunsPerWorkspace > runtimeClass.resourceCeiling.maxConcurrentRuns)
    throw new Error(`Agent ${agent.id} exceeds its runtime concurrency ceiling.`);
  if (workspaceRank(agent.workspaceAccess) > mountRank(runtimeClass.mountPolicy))
    throw new Error(`Agent ${agent.id} exceeds its runtime workspace mount ceiling.`);
}

function validateAgentReferences(
  agent: CompiledAgentV2,
  input: AgentClosureInput,
  agentIds: ReadonlySet<string>,
  runtimeClass: RuntimeClassPinV2
): void {
  if (agent.model && !input.reviewedModelIds.has(modelKey(agent.model)))
    throw new Error(`Agent ${agent.id} references an unreviewed model.`);
  for (const featureId of agent.runtimeFeatureIds) {
    if (!input.runtimeFeatureIds.has(featureId))
      throw new Error(`Agent ${agent.id} references unknown runtime feature: ${featureId}.`);
    if (!runtimeClass.featureIds.includes(featureId))
      throw new Error(
        `Agent ${agent.id} runtime class ${runtimeClass.id} does not provide feature: ${featureId}.`
      );
  }
  for (const childId of agent.delegation?.mayDelegateTo ?? []) {
    if (!agentIds.has(childId))
      throw new Error(`Agent ${agent.id} delegates to unknown agent: ${childId}.`);
  }
}

function validateAgentCapabilities(
  agent: CompiledAgentV2,
  runtimeClass: RuntimeClassPinV2,
  capabilityById: ReadonlyMap<string, CompiledCapabilityProviderV2>
): void {
  for (const capabilityId of agent.capabilityIds) {
    const capability = capabilityById.get(capabilityId);
    if (!capability)
      throw new Error(`Agent ${agent.id} references unknown capability: ${capabilityId}.`);
    if (capability.providerKind === "local")
      validateLocalCapabilityCeiling(agent, runtimeClass, capability);
  }
}

function validateLocalCapabilityCeiling(
  agent: CompiledAgentV2,
  runtimeClass: RuntimeClassPinV2,
  capability: LocalCapabilityV2
): void {
  if (filesystemRank(capability.filesystem) > workspaceRank(agent.workspaceAccess))
    throw new Error(
      `Capability ${capability.capabilityId} exceeds agent ${agent.id} workspace access.`
    );
  if (networkRank(capability.network) > networkRank(runtimeClass.networkPolicy))
    throw new Error(
      `Capability ${capability.capabilityId} exceeds agent ${agent.id} network ceiling.`
    );
  if (
    capability.process === "arbitrary" &&
    mountRank(runtimeClass.mountPolicy) > workspaceRank(agent.workspaceAccess)
  )
    throw new Error(
      `Arbitrary process capability ${capability.capabilityId} can exceed agent ${agent.id} workspace access.`
    );
}

function workspaceRank(value: CompiledAgentV2["workspaceAccess"]): number {
  return { none: 0, read: 1, "scoped-write": 2, write: 3 }[value];
}

function mountRank(value: RuntimeClassPinV2["mountPolicy"]): number {
  return { none: 0, "read-only": 1, "scoped-write": 2, "read-write": 3 }[value];
}

function filesystemRank(value: LocalCapabilityV2["filesystem"]): number {
  return { none: 0, "read-only": 1, "workspace-scoped-write": 2 }[value];
}

function networkRank(
  value: RuntimeClassPinV2["networkPolicy"] | LocalCapabilityV2["network"]
): number {
  return { none: 0, restricted: 1, "browser-restricted": 1 }[value];
}
