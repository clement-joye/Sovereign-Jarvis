import type { PiRunBudgetMeter, RunBudgetExceeded } from "./pi-run-budget.js";
import type { CreatedPiSession } from "../sessions/pi-session-factory.js";

type PiSession = CreatedPiSession["session"];
type PiSessionEvent = Parameters<Parameters<PiSession["subscribe"]>[0]>[0];

/** Collects streamed assistant output and enforces run budgets. */
export class PiRunOutputCollector {
  text = "";
  budgetError: RunBudgetExceeded | undefined;

  constructor(
    private readonly session: PiSession,
    readonly meter: PiRunBudgetMeter
  ) {}

  subscribe(): () => void {
    return this.session.subscribe((event) => this.record(event));
  }

  private record(event: PiSessionEvent): void {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      this.recordText(event.assistantMessageEvent.delta);
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      this.recordUsage(event.message.usage.totalTokens);
    }
  }

  private recordText(delta: string): void {
    try {
      this.text = this.meter.addText(this.text, delta);
    } catch (error) {
      this.abortForBudget(error);
    }
  }

  private recordUsage(totalTokens: number): void {
    try {
      this.meter.addAssistantUsage(totalTokens);
    } catch (error) {
      this.abortForBudget(error);
    }
  }

  private abortForBudget(error: unknown): void {
    this.budgetError ??= error as RunBudgetExceeded;
    this.session.agent.abort();
  }
}
