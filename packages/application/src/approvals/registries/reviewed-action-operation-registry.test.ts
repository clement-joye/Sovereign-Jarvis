import type { CompiledCapabilityProviderV2 } from "@second-brain/contracts";
import { describe, expect, it } from "vitest";

import { ReviewedActionOperationRegistry } from "./reviewed-action-operation-registry.js";

describe("ReviewedActionOperationRegistry", () => {
  it("projects plugin, capability, operation, and approval floor from the catalog", () => {
    const registry = new ReviewedActionOperationRegistry({
      catalog: { capabilities: [capability()] }
    });

    expect(registry.require("calendar-publish")).toEqual({
      pluginId: "calendar",
      operation: {
        capabilityId: "calendar-events",
        operationId: "calendar-publish",
        operationVersion: "1.0.0",
        approvalPolicy: { minimumMode: "owner", userMayStrengthen: true }
      }
    });
    expect(() => registry.require("missing")).toThrow("Unknown reviewed action operation");
  });
});

function capability(): CompiledCapabilityProviderV2 {
  return {
    capabilityId: "calendar-events",
    pluginId: "calendar",
    providerId: "calendar-provider",
    implementationId: "calendar-control",
    definitionDigest: `sha256:${"a".repeat(64)}`,
    providerKind: "broker",
    toolIds: ["calendar_publish"],
    configurationSchema: {},
    operations: [
      {
        id: "calendar-publish",
        toolName: "calendar_publish",
        sideEffect: "external",
        approvalPolicy: "owner",
        idempotencyPolicy: "required"
      }
    ]
  };
}
