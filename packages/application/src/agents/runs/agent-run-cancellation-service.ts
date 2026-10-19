import type { AgentRunV1 } from "@second-brain/contracts";
import type { ClockPort } from "@second-brain/domain";

import type { AgentCollaborationRepositoryPort } from "../../ports.js";
import type { AgentRunCancellationFinalizer } from "./agent-run-cancellation-finalizer.js";

export interface AgentRunCancellationPort {
  cancel(run: Pick<AgentRunV1, "id" | "workspaceId">): Promise<void>;
}

/** Stops a run tree children-first and releases its admission only after runtime acknowledgement. */
export class AgentRunCancellationService {
  constructor(
    private readonly runs: Pick<
      AgentCollaborationRepositoryPort,
      "getRun" | "listChildren" | "updateRun"
    >,
    private readonly runtime: AgentRunCancellationPort,
    private readonly clock: ClockPort,
    private readonly finalizer: AgentRunCancellationFinalizer
  ) {}

  async cancel(runId: string): Promise<AgentRunV1 | undefined> {
    const run = await this.runs.getRun(runId);
    if (!run) return undefined;
    await this.cancelTree(run);
    await this.finalizer.releaseRootAdmission(run);
    return this.runs.getRun(runId);
  }

  private async cancelTree(run: AgentRunV1): Promise<void> {
    const children = await this.runs.listChildren(run.id);
    await Promise.all(children.map((child) => this.cancelTree(child)));
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") return;
    await this.finalizer.cancelApprovals(run);
    // Signal first. If the runtime call fails, the run remains retryably active and
    // the root admission is retained; a later cancellation can safely try again.
    if (run.status === "running") await this.runtime.cancel(run);
    await this.runs.updateRun({
      ...run,
      status: "cancelled",
      completedAt: this.clock.now().toISOString()
    });
  }
}
