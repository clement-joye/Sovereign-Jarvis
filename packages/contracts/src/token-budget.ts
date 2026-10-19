import { z } from "zod";

/** Explicitly disables cumulative model-token metering for a reviewed run policy. */
export const UnlimitedTokenBudget = "unlimited";
export const TokenBudgetSchema = z.union([
  z.number().int().positive().max(1_000_000),
  z.literal(UnlimitedTokenBudget)
]);
export type TokenBudget = z.infer<typeof TokenBudgetSchema>;

/** Returns the narrowest budget. Unlimited contributes no finite ceiling. */
export function minimumTokenBudget(...budgets: readonly (TokenBudget | undefined)[]): TokenBudget {
  const finite = budgets.filter((budget): budget is number => typeof budget === "number");
  return finite.length > 0 ? Math.min(...finite) : UnlimitedTokenBudget;
}

/** Whether a requested budget exceeds a reviewed parent/runtime ceiling. */
export function tokenBudgetExceeds(requested: TokenBudget, ceiling: TokenBudget): boolean {
  if (ceiling === UnlimitedTokenBudget) return false;
  return requested === UnlimitedTokenBudget || requested > ceiling;
}
