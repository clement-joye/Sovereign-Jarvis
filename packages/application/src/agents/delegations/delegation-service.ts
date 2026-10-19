import {
  tokenBudgetExceeds,
  type AgentRunV1,
  type DelegationGrantV1,
  type EffectiveRunPolicyV2
} from "@second-brain/contracts";
import type { ClockPort } from "@second-brain/domain";

import type { AgentCollaborationRepositoryPort, JobQueuePort } from "../../ports.js";
import type { DelegatedRunFactory } from "./delegated-run-factory.js";

/** Creates child runs only through durable records and idempotent queue jobs. */
export class DelegationService {
  constructor(
    private readonly runs: AgentCollaborationRepositoryPort,
    private readonly jobs: JobQueuePort,
    private readonly factory: DelegatedRunFactory,
    private readonly clock: ClockPort
  ) {}
  async createChild(input: {
    parent: AgentRunV1;
    grant: DelegationGrantV1;
    task: string;
    effectiveRunPolicy?: EffectiveRunPolicyV2;
  }): Promise<AgentRunV1> {
    validateGrantLineage(input.parent, input.grant, this.clock.now());
    if (
      this.jobs.hasLiveRootAdmission &&
      !(await this.jobs.hasLiveRootAdmission(input.parent.rootRunId, this.clock.now()))
    ) {
      throw new Error("Delegation root no longer has a live admission lease.");
    }
    const { run: child, job } = this.factory.create({
      parent: input.parent,
      grant: input.grant,
      task: input.task,
      now: this.clock.now(),
      ...(input.effectiveRunPolicy ? { effectiveRunPolicy: input.effectiveRunPolicy } : {})
    });
    await this.runs.createGrant(input.grant);
    const stored = await this.runs.createRun(child);
    await this.jobs.enqueue(job);
    return stored;
  }
}

function validateGrantLineage(parent: AgentRunV1, grant: DelegationGrantV1, now: Date): void {
  if (parent.id !== grant.parentRunId) throw new Error("Delegation grant parent run mismatch.");
  if (parent.workspaceId !== grant.workspaceId)
    throw new Error("Delegation grant workspace mismatch.");
  if (parent.status !== "running") throw new Error("Delegation parent run is not active.");
  const parentDeadline = new Date(parent.deadlineAt).getTime();
  const grantDeadline = new Date(grant.expiresAt).getTime();
  if (grantDeadline > parentDeadline)
    throw new Error("Delegation grant cannot outlive its parent run deadline.");
  if (grantDeadline <= now.getTime()) throw new Error("Delegation grant has expired.");
  // Grant creation and validation use separate clock reads. Round the stored
  // whole-second authority up here so a few milliseconds of processing do not
  // reject a grant that was correctly bounded at creation. Execution later
  // floors the live remaining duration before starting the model.
  const remainingSeconds = Math.ceil((grantDeadline - now.getTime()) / 1_000);
  if (grant.timeoutSeconds > parent.timeoutSeconds || grant.timeoutSeconds > remainingSeconds)
    throw new Error("Delegation timeout exceeds parent or grant deadline authority.");
  if (tokenBudgetExceeds(grant.tokenBudget, parent.tokenBudget))
    throw new Error("Delegation token budget exceeds parent authority.");
}
