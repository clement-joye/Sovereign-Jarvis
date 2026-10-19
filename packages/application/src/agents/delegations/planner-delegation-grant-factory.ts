import type {
  AgentRunV1,
  DelegationGrantV1,
  PlannerDelegationSpecV1
} from "@second-brain/contracts";
import { minimumTokenBudget } from "@second-brain/contracts";
import type { AgentCatalog, ClockPort, IdGeneratorPort } from "@second-brain/domain";

/** Validates delegation policy and creates a bounded child grant. */
export class PlannerDelegationGrantFactory {
  constructor(
    private readonly catalog: AgentCatalog,
    private readonly ids: IdGeneratorPort,
    private readonly clock: ClockPort
  ) {}

  create(
    parent: AgentRunV1,
    spec: PlannerDelegationSpecV1,
    activeChildren: number
  ): DelegationGrantV1 {
    if (parent.parentRunId || parent.delegationGrantId) {
      throw new Error("Delegated children may not delegate.");
    }
    const delegator = this.catalog.require(parent.agentId);
    if (!delegator.delegation) throw new Error("This agent may not delegate.");
    if (!delegator.delegation.mayDelegateTo.includes(spec.targetAgentId)) {
      throw new Error(
        `Delegation target is not enabled in the reviewed catalog: ${spec.targetAgentId}.`
      );
    }
    const target = this.catalog.require(spec.targetAgentId);
    if (activeChildren >= delegator.delegation.maxChildren) {
      throw new Error(`Active child run limit (${delegator.delegation.maxChildren}) reached.`);
    }
    const now = this.clock.now();
    const expiresAt = new Date(parent.deadlineAt);
    if (expiresAt <= now) throw new Error("Parent run deadline has elapsed.");
    const remainingSeconds = Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1_000));
    return {
      schemaVersion: 1,
      id: this.ids.nextId("delegation-grant"),
      parentRunId: parent.id,
      workspaceId: parent.workspaceId,
      childAgentId: spec.targetAgentId,
      allowedTools: spec.allowedTools,
      readablePaths: spec.readablePaths,
      writablePaths: spec.writablePaths,
      timeoutSeconds: Math.min(parent.timeoutSeconds, target.timeoutSeconds, remainingSeconds),
      tokenBudget: minimumTokenBudget(parent.tokenBudget, target.tokenBudget),
      expiresAt: expiresAt.toISOString()
    };
  }
}
