import type { AgentCatalog } from "@second-brain/domain";

type ResourcePolicyCatalog = Pick<AgentCatalog, "require" | "runtimeClass">;

/** Narrows a requested timeout to both reviewed agent and runtime-class ceilings. */
export function boundedAgentTimeoutSeconds(
  catalog: ResourcePolicyCatalog,
  agentId: string,
  requestedTimeoutSeconds: number
): number {
  const agent = catalog.require(agentId);
  const runtime = catalog.runtimeClass(agentId);
  return Math.min(requestedTimeoutSeconds, agent.timeoutSeconds, runtime.timeoutSeconds);
}
