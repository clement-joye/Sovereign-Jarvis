import type { AgentCatalog } from "./agent-catalog.js";

/**
 * Intersects a role's reviewed tool ceiling with the runtime's configured
 * allowlist. Runtime configuration can narrow a role but cannot expand it.
 */
export function effectiveAgentTools(
  catalog: AgentCatalog,
  agentId: string,
  runtimeAllowedTools?: readonly string[]
): readonly string[] {
  const roleTools = catalog.require(agentId).toolPolicy;
  if (!runtimeAllowedTools) return roleTools;
  const runtimeTools = new Set(runtimeAllowedTools);
  return roleTools.filter((tool) => runtimeTools.has(tool));
}
