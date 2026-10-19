import { describe, expect, it, vi } from "vitest";

import { executeRuntimeAction, registerRuntimeActionControl } from "./runtime-action-control.js";

describe("plugin runtime action control", () => {
  it("passes validated operation IDs to the registered extension bridge", async () => {
    const execute = vi.fn().mockResolvedValue({ acted: true });
    registerRuntimeActionControl({ execute });

    await expect(executeRuntimeAction("browser-click", { selector: "#save" })).resolves.toEqual({
      acted: true
    });
    expect(execute).toHaveBeenCalledWith("browser-click", { selector: "#save" });
    await expect(executeRuntimeAction("Browser evaluate", {})).rejects.toThrow(
      "Invalid runtime action"
    );
  });
});
