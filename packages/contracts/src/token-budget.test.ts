import { describe, expect, it } from "vitest";

import { minimumTokenBudget, TokenBudgetSchema, tokenBudgetExceeds } from "./token-budget.js";

describe("token budgets", () => {
  it("accepts an explicit unlimited policy", () => {
    expect(TokenBudgetSchema.parse("unlimited")).toBe("unlimited");
  });

  it("selects the narrowest finite budget", () => {
    expect(minimumTokenBudget("unlimited", 300_000, 500_000)).toBe(300_000);
    expect(minimumTokenBudget("unlimited", "unlimited")).toBe("unlimited");
  });

  it("does not allow unlimited authority beneath a finite ceiling", () => {
    expect(tokenBudgetExceeds("unlimited", 300_000)).toBe(true);
    expect(tokenBudgetExceeds(300_000, "unlimited")).toBe(false);
  });
});
