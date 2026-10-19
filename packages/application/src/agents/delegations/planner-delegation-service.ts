import type {
  AgentArtifactV1,
  AgentRunV1,
  EffectiveRunPolicyV2,
  PlannerDelegationSpecV1
} from "@second-brain/contracts";

import type { AgentCollaborationRepositoryPort } from "../../ports.js";
import type { DelegationService } from "./delegation-service.js";
import type { PlannerDelegationGrantFactory } from "./planner-delegation-grant-factory.js";

/** Enforces Planner's reviewed one-child, non-recursive delegation boundary. */
export class PlannerDelegationService {
  constructor(
    private readonly runs: Pick<
      AgentCollaborationRepositoryPort,
      "listChildren" | "listArtifactsByRun"
    >,
    private readonly delegation: Pick<DelegationService, "createChild">,
    private readonly grants: PlannerDelegationGrantFactory
  ) {}

  async delegate(input: {
    parent: AgentRunV1;
    spec: PlannerDelegationSpecV1;
    effectiveRunPolicy?: EffectiveRunPolicyV2;
  }): Promise<AgentRunV1> {
    const active = (await this.runs.listChildren(input.parent.id)).filter(
      (run) => run.status === "queued" || run.status === "running"
    );
    return this.delegation.createChild({
      parent: input.parent,
      grant: this.grants.create(input.parent, input.spec, active.length),
      task: input.spec.task,
      ...(input.effectiveRunPolicy ? { effectiveRunPolicy: input.effectiveRunPolicy } : {})
    });
  }

  async childResults(
    parentRunId: string
  ): Promise<Array<{ run: AgentRunV1; artifacts: AgentArtifactV1[] }>> {
    const children = await this.runs.listChildren(parentRunId);
    return Promise.all(
      children.map(async (run) => ({ run, artifacts: await this.runs.listArtifactsByRun(run.id) }))
    );
  }
}
