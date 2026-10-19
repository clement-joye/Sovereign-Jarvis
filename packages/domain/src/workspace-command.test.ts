import { describe, expect, it } from "vitest";

import { parseWorkspaceCommand } from "./workspace.js";

describe("parseWorkspaceCommand", () => {
  it("parses the deterministic onboarding actions", () => {
    expect(parseWorkspaceCommand("/workspace status")).toEqual({ type: "status" });
    expect(parseWorkspaceCommand("/workspace use second-brain")).toEqual({
      type: "use-template",
      templateId: "second-brain"
    });
    expect(parseWorkspaceCommand("/workspace configure Stockholm")).toEqual({
      type: "configure",
      answer: "Stockholm"
    });
    expect(parseWorkspaceCommand("/workspace confirm")).toEqual({ type: "confirm" });
    expect(parseWorkspaceCommand("/workspace archive")).toEqual({ type: "archive" });
  });

  it("keeps ordinary messages outside the onboarding command surface", () => {
    expect(parseWorkspaceCommand("hello")).toEqual({ type: "not-workspace-command" });
    expect(parseWorkspaceCommand("/workspace use")).toEqual({
      type: "invalid",
      message: "/workspace use requires a template id."
    });
  });
});
