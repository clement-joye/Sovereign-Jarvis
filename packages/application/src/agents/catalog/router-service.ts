import type { RouterDecisionV1 } from "@second-brain/contracts";
import type { AgentCatalog } from "@second-brain/domain";

/** Deterministic, opt-in intent router with no execution authority. */
export class RouterService {
  constructor(private readonly catalog: AgentCatalog) {}

  route(text: string, candidateAgentIds: readonly string[] = this.catalog.ids()): RouterDecisionV1 {
    const normalized = text.toLowerCase();
    const candidates = new Set(candidateAgentIds);
    const selected = this.catalog
      .ids()
      .filter((agentId) => candidates.has(agentId))
      .map((agentId) => this.catalog.require(agentId))
      .filter((agent) => agent.routing?.keywords.some((keyword) => matches(normalized, keyword)))
      .sort(
        (left, right) =>
          (right.routing?.confidence ?? 0) - (left.routing?.confidence ?? 0) ||
          left.id.localeCompare(right.id)
      )[0];
    if (selected?.routing)
      return decision(
        selected.id,
        selected.routing.confidence,
        selected.routing.reason,
        selected.routing.confirmationRequirements
      );
    return decision(
      this.catalog.defaultAgentId(),
      0.35,
      "Low-confidence general request; use the catalog default agent."
    );
  }
}

function matches(text: string, keyword: string): boolean {
  const normalizedKeyword = keyword.toLowerCase();
  if (normalizedKeyword.includes(" ")) return text.includes(normalizedKeyword);
  return new RegExp(`\\b${escapeRegExp(normalizedKeyword)}\\b`, "u").test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decision(
  primaryAgentId: string,
  confidence: number,
  reason: string,
  confirmationRequirements: string[] = []
): RouterDecisionV1 {
  return { primaryAgentId, childTasks: [], confidence, confirmationRequirements, reason };
}
