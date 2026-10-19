import { describe, expect, it, vi } from "vitest";

import { PrivilegedBrokerRegistry } from "./privileged-broker-registry.js";

describe("PrivilegedBrokerRegistry", () => {
  it("dispatches only explicitly installed immutable handlers", async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true });
    const registry = new PrivilegedBrokerRegistry([
      { implementationId: "example-control", execute }
    ]);
    const input = { workspaceId: "workspace-one", operationId: "send", parameters: {} };
    await expect(registry.execute("example-control", input)).resolves.toEqual({ ok: true });
    await expect(registry.execute("removed-control", input)).rejects.toThrow(/unavailable/);
  });
});
