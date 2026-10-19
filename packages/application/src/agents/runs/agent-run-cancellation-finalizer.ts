import type { AgentRunV1 } from "@second-brain/contracts";
import type { ClockPort } from "@second-brain/domain";

import type { ActionProposalService } from "../../approvals/commands/approval-service.js";
import type { JobQueuePort } from "../../ports.js";

/** Cleans up durable authority and root admission after run cancellation. */
export class AgentRunCancellationFinalizer {
  constructor(
    private readonly clock: ClockPort,
    private readonly approvals?: Pick<ActionProposalService, "cancelForRun">,
    private readonly jobs?: Pick<JobQueuePort, "cancelRootRun">
  ) {}

  async cancelApprovals(run: AgentRunV1): Promise<void> {
    await this.approvals?.cancelForRun({
      workspaceId: run.workspaceId,
      runId: run.id,
      now: this.clock.now()
    });
  }

  async releaseRootAdmission(run: AgentRunV1): Promise<void> {
    await this.jobs?.cancelRootRun?.({
      rootRunId: run.rootRunId,
      now: this.clock.now(),
      reason: "agent_tree_cancelled"
    });
  }
}
