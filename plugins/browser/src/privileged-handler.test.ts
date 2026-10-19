import { describe, expect, it, vi } from "vitest";
import { createBrowserPrivilegedHandler } from "./privileged-handler.js";

describe("browser privileged handler", () => {
  it("forwards approved mutations to the Browser agent runtime", async () => {
    const executeRuntimeAction = vi.fn().mockResolvedValue({ acted: true });
    const handler = createBrowserPrivilegedHandler({ executeRuntimeAction });
    await expect(
      handler.execute({
        workspaceId: "workspace-one",
        operationId: "browser-click",
        parameters: { selector: "#save" }
      })
    ).resolves.toEqual({ acted: true });
    expect(executeRuntimeAction).toHaveBeenCalledWith("workspace-one", "browser", "browser-click", {
      selector: "#save"
    });
  });

  it("rejects undeclared runtime actions", async () => {
    const handler = createBrowserPrivilegedHandler({ executeRuntimeAction: vi.fn() });
    await expect(
      handler.execute({ workspaceId: "workspace-one", operationId: "evaluate", parameters: {} })
    ).rejects.toThrow("Unsupported browser action");
  });
});
