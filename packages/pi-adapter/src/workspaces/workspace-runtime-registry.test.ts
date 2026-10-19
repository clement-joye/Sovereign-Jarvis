import { describe, expect, it } from "vitest";
import { WorkspaceRuntimeRegistry } from "./workspace-runtime-registry.js";

describe("WorkspaceRuntimeRegistry", () => {
  it("provisions only approved template versions and isolates lifecycle by workspace", async () => {
    const runtimes = new WorkspaceRuntimeRegistry(new Set(["second-brain@1.0.0"]));
    await expect(
      runtimes.provision({
        workspaceId: "one",
        templateId: "code",
        templateVersion: "1",
        configuration: {}
      })
    ).rejects.toThrow("Unapproved");
    await runtimes.provision({
      workspaceId: "one",
      templateId: "second-brain",
      templateVersion: "1.0.0",
      configuration: {}
    });
    await runtimes.archive("one");
    expect(await runtimes.health("one")).toBe("archived");
    expect(await runtimes.health("two")).toBe("unprovisioned");
  });
});
