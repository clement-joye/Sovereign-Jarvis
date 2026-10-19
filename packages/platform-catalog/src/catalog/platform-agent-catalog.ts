import type { AgentDefinitionV1, RuntimeClassDefinitionV1 } from "@second-brain/contracts/schemas";
import type { PlatformCatalogV2 } from "@second-brain/contracts/platform-catalog";
import type { AgentCatalog, AgentId } from "@second-brain/domain";

/**
 * Version projected into the current durable-run contract. Authority and
 * identity come exclusively from the compiled catalog digest.
 */
const PLATFORM_CATALOG_VERSION = "2.0.0";

/**
 * Projects the compiled release artifact onto the application's read-only
 * agent catalog port. This is a runtime view, not a second catalog or compiler.
 */
export function createPlatformAgentCatalog(catalog: Readonly<PlatformCatalogV2>): AgentCatalog {
  const capabilities = new Map(
    catalog.capabilities.map((capability) => [capability.capabilityId, capability])
  );
  const runtimeClasses = new Map<string, RuntimeClassDefinitionV1>(
    catalog.runtimeClasses.map((runtimeClass) => [
      runtimeClass.id,
      Object.freeze({
        id: runtimeClass.id,
        image: runtimeClass.image,
        networkPolicy: runtimeClass.networkPolicy,
        maxConcurrentRuns: runtimeClass.resourceCeiling.maxConcurrentRuns,
        timeoutSeconds: runtimeClass.resourceCeiling.timeoutSeconds,
        memoryMiB: runtimeClass.resourceCeiling.memoryMiB,
        cpuMillicores: runtimeClass.resourceCeiling.cpuMillicores
      })
    ])
  );
  const agents = new Map<string, AgentDefinitionV1>(
    catalog.agents.map((agent) => {
      const runtimeClass = runtimeClasses.get(agent.runtimeClass);
      if (!runtimeClass) throw new Error(`Missing runtime class for agent ${agent.id}.`);
      const toolPolicy = agent.capabilityIds.flatMap((capabilityId) => {
        const capability = capabilities.get(capabilityId);
        if (!capability)
          throw new Error(`Missing compiled capability for agent ${agent.id}: ${capabilityId}.`);
        return capability.toolIds;
      });
      const definition: AgentDefinitionV1 = {
        schemaVersion: 1,
        id: agent.id,
        version: PLATFORM_CATALOG_VERSION,
        runtimeClass: agent.runtimeClass,
        promptPath: agent.promptPath,
        skillPaths: [...agent.skillPaths],
        extensionPaths: [...agent.extensionPaths],
        toolPolicy,
        networkPolicy: runtimeClass.networkPolicy,
        workspaceAccess: agent.workspaceAccess,
        threadContextPolicy: agent.threadContextPolicy,
        ...(agent.defaultForWorkspace ? { defaultForWorkspace: true } : {}),
        ...(agent.routesInbound ? { routesInbound: true } : {}),
        ...(agent.routing
          ? {
              routing: {
                ...agent.routing,
                keywords: [...agent.routing.keywords],
                confirmationRequirements: [...agent.routing.confirmationRequirements]
              }
            }
          : {}),
        ...(agent.model ? { model: { ...agent.model } } : {}),
        timeoutSeconds: agent.timeoutSeconds,
        tokenBudget: agent.tokenBudget,
        maxConcurrentRunsPerWorkspace: agent.maxConcurrentRunsPerWorkspace,
        ...(agent.delegation
          ? {
              delegation: {
                mayDelegateTo: [...agent.delegation.mayDelegateTo],
                toolPolicyByAgent: Object.fromEntries(
                  Object.entries(agent.delegation.toolPolicyByAgent).map(([agentId, tools]) => [
                    agentId,
                    [...tools]
                  ])
                ),
                maxChildren: agent.delegation.maxChildren
              }
            }
          : {})
      };
      return [agent.id, deepFreeze(definition)];
    })
  );
  const defaultAgent = [...agents.values()].find((agent) => agent.defaultForWorkspace)!;
  const inboundRouter = [...agents.values()].find((agent) => agent.routesInbound);

  return Object.freeze({
    version: PLATFORM_CATALOG_VERSION,
    digest: catalog.digest,
    get: (agentId: string) => agents.get(agentId),
    require: (agentId: string) => {
      const agent = agents.get(agentId);
      if (!agent) throw new Error(`Unknown agent id in platform catalog: ${agentId}.`);
      return agent;
    },
    runtimeClass: (agentId: string) => {
      const agent = agents.get(agentId);
      if (!agent) throw new Error(`Unknown agent id in platform catalog: ${agentId}.`);
      const runtimeClass = runtimeClasses.get(agent.runtimeClass);
      if (!runtimeClass)
        throw new Error(`Missing runtime class for agent ${agentId}: ${agent.runtimeClass}.`);
      return runtimeClass;
    },
    ids: () => [...agents.keys()] as AgentId[],
    defaultAgentId: () => defaultAgent.id,
    inboundRouterId: () => inboundRouter?.id
  });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
