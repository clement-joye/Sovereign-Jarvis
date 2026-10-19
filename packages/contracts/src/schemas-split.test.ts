import { describe, expect, it } from "vitest";
import {
  AgentCatalogV1Schema,
  AgentRunV1Schema,
  ActionProposalOutcomeV1Schema,
  AttachmentReferenceV1Schema,
  HealthStatusV1Schema,
  SchemaVersionV1
} from "./schemas.js";
import { ActionProposalOutcomeV1Schema as approvalOutcome } from "./schemas/approval.js";
import { AgentCatalogV1Schema as agentCatalog } from "./schemas/agent-catalog.js";
import { AgentRunV1Schema as agentRun } from "./schemas/agent-collaboration.js";
import { SchemaVersionV1 as commonVersion } from "./schemas/common.js";
import { HealthStatusV1Schema as healthStatus } from "./schemas/health.js";
import { AttachmentReferenceV1Schema as mediaAttachment } from "./schemas/media.js";

describe("schema feature boundaries", () => {
  it("keeps the compatibility facade bound to feature-owned schemas", () => {
    expect(SchemaVersionV1).toBe(commonVersion);
    expect(HealthStatusV1Schema).toBe(healthStatus);
    expect(AttachmentReferenceV1Schema).toBe(mediaAttachment);
    expect(ActionProposalOutcomeV1Schema).toBe(approvalOutcome);
    expect(AgentCatalogV1Schema).toBe(agentCatalog);
    expect(AgentRunV1Schema).toBe(agentRun);
  });
});
