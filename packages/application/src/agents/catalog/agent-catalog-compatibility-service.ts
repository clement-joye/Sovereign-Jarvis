import type { AgentCatalog } from "@second-brain/domain";
import type { DurableAgentReferenceRepositoryPort } from "../../ports.js";

/** Verifies that all durable agent references remain present in the active catalog. */
export class AgentCatalogCompatibilityService {
  constructor(
    private readonly references: DurableAgentReferenceRepositoryPort,
    private readonly catalog: AgentCatalog
  ) {}

  async assertCompatible(): Promise<void> {
    const ids = [...new Set(await this.references.listReferencedAgentIds())].sort();
    const missing = ids.filter((id) => !this.catalog.get(id));
    if (missing.length) {
      throw new Error(`Durable agent references absent from active catalog: ${missing.join(", ")}`);
    }
  }
}
