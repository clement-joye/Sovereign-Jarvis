import { join } from "node:path";

import type { AgentCatalog } from "@second-brain/domain";

export function piSessionDirectory(
  sessionRoot: string,
  sessionId: string,
  agentId: string,
  catalogDigest: string
): string {
  return join(
    sessionRoot,
    sessionId,
    `pi-agent-${agentId}-${catalogDigest.replace(/^sha256:/u, "")}`
  );
}

export function activePiToolNames(
  allowedTools: readonly string[],
  customTools: readonly { name: string }[]
): string[] {
  // `tools` is both Pi's activation list and its registry allowlist. Extension
  // tools are registered by ResourceLoader, not included in `customTools`, so
  // dropping their names here silently removes them from the registry.
  return [...new Set([...allowedTools, ...customTools.map((tool) => tool.name)])];
}

/** Resolves a role's reviewed model, falling back to the runtime default. */
export function modelSelectionForAgent(
  agent: ReturnType<AgentCatalog["require"]>,
  fallback: { providerId: string; modelId: string }
): { providerId: string; modelId: string } {
  return agent.model ?? fallback;
}
