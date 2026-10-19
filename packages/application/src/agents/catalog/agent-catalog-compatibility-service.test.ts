import { describe, expect, it } from "vitest";
import { INITIAL_AGENT_CATALOG } from "@second-brain/domain";
import { AgentCatalogCompatibilityService } from "./agent-catalog-compatibility-service.js";

describe("AgentCatalogCompatibilityService", () => {
  it("accepts references present in the catalog", async () => {
    await expect(
      new AgentCatalogCompatibilityService(
        { listReferencedAgentIds: async () => ["brain"] },
        INITIAL_AGENT_CATALOG
      ).assertCompatible()
    ).resolves.toBeUndefined();
  });
  it("reports sorted missing IDs", async () => {
    await expect(
      new AgentCatalogCompatibilityService(
        { listReferencedAgentIds: async () => ["zeta", "missing"] },
        INITIAL_AGENT_CATALOG
      ).assertCompatible()
    ).rejects.toThrow("missing, zeta");
  });
});
