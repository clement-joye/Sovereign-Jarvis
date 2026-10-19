import type { TokenBudget } from "@second-brain/contracts";

/** Error raised when a Pi run exceeds one of its reviewed output budgets. */
export class RunBudgetExceeded extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunBudgetExceeded";
  }
}

/** Meters the complete Pi tool loop, including streamed text and returned files. */
export class PiRunBudgetMeter {
  private tokensUsed = 0;
  private outputBytes = 0;

  constructor(
    readonly tokenBudget: TokenBudget,
    readonly maxOutputBytes: number
  ) {}

  addText(current: string, delta: string): string {
    this.consumeOutput(Buffer.byteLength(delta, "utf8"));
    return current + delta;
  }

  addAssistantUsage(totalTokens: number): void {
    this.tokensUsed += totalTokens;
    if (this.tokenBudget !== "unlimited" && this.tokensUsed > this.tokenBudget) {
      throw new RunBudgetExceeded(`Pi run exceeded its ${this.tokenBudget} token budget.`);
    }
  }

  consumeOutput(bytes: number): void {
    this.outputBytes += bytes;
    if (this.outputBytes > this.maxOutputBytes) {
      throw new RunBudgetExceeded(`Pi run exceeded its ${this.maxOutputBytes} byte output budget.`);
    }
  }
}
