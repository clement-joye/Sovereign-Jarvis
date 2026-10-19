import { describe, expect, it } from "vitest";

import { formatSystemMessage } from "./system-message.js";

describe("formatSystemMessage", () => {
  it("renders a visible plain-text banner without relying on Markdown", () => {
    expect(formatSystemMessage("APPROVAL REQUIRED", "Push main\n\n/yes — Approve")).toBe(
      "━━ JARVIS · APPROVAL REQUIRED ━━\n\nPush main\n\n/yes — Approve"
    );
  });

  it("does not leave trailing whitespace for an empty body", () => {
    expect(formatSystemMessage("ERROR", "  ")).toBe("━━ JARVIS · ERROR ━━");
  });
});
