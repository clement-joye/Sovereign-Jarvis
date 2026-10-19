import type { InboundMessageV1 } from "@second-brain/contracts";

import type { AgentCatalog } from "./agent-catalog.js";

/** Resolves a reviewed explicit role prefix without changing ordinary text. */
export function selectExplicitAgent(
  message: InboundMessageV1,
  catalog: AgentCatalog
): InboundMessageV1 | undefined {
  const match = message.text?.match(/^@([a-z][a-z0-9-]{0,63})(?::|\s+)([\s\S]*)$/i);
  if (!match) return undefined;

  const agentId = match[1]!.toLowerCase();
  if (!catalog.get(agentId)) return undefined;

  const text = match[2]!.trim();
  return { ...message, agentId, ...(text ? { text } : {}) };
}
