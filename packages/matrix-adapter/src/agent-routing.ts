import type { InboundMessageV1 } from "@second-brain/contracts";
import { selectExplicitAgent, type AgentCatalog } from "@second-brain/domain";

export type RoomAgentId = string;

/**
 * Recognises an intentional agent prefix only at the very start of a message.
 * This keeps ordinary Matrix mentions out of the command surface.
 */
export function selectMessageAgent(
  message: InboundMessageV1,
  defaultAgent: RoomAgentId | undefined,
  catalog: AgentCatalog
): InboundMessageV1 {
  const selectedDefault = defaultAgent ?? catalog.defaultAgentId();
  catalog.require(selectedDefault);
  return selectExplicitAgent(message, catalog) ?? { ...message, agentId: selectedDefault };
}
