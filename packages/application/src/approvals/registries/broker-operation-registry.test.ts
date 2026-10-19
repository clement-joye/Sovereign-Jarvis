import { describe, expect, it, vi } from "vitest";

import { BrokerOperationRegistry } from "./broker-operation-registry.js";

describe("BrokerOperationRegistry", () => {
  it("resolves implementation from catalog policy and rejects undeclared handlers", async () => {
    const requestOperation = vi.fn().mockResolvedValue({ schemaVersion: 1, outcome: "pending" });
    const handler = {
      implementationId: "example-control",
      requestOperation,
      executeApproved: vi.fn()
    };
    const registry = new BrokerOperationRegistry(catalog(), [handler]);

    await registry.request({
      workspaceId: "workspace-one",
      agentId: "brain",
      runId: "run-one",
      pluginId: "example",
      operationId: "example-send",
      idempotencyKey: "call-one",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      parameters: { message: "hello" }
    });

    expect(requestOperation).toHaveBeenCalledOnce();
    expect(registry.resolve("example", "example-send").operation.toolName).toBe("example_send");
    expect(() => registry.resolve("other", "example-send")).toThrow(/unavailable/);
    expect(
      () =>
        new BrokerOperationRegistry(catalog(), [{ ...handler, implementationId: "not-installed" }])
    ).toThrow(/not declared/);
  });
});

function catalog() {
  return {
    capabilities: [
      {
        capabilityId: "example-send",
        pluginId: "example",
        providerId: "example-provider",
        implementationId: "example-control",
        definitionDigest: `sha256:${"a".repeat(64)}`,
        providerKind: "broker" as const,
        toolIds: ["example_send"],
        configurationSchema: {},
        operations: [
          {
            id: "example-send",
            toolName: "example_send",
            sideEffect: "external" as const,
            approvalPolicy: "owner" as const,
            idempotencyPolicy: "required" as const
          }
        ]
      }
    ]
  };
}
