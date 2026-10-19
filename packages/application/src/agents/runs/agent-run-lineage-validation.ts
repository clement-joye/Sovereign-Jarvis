import {
  tokenBudgetExceeds,
  type AgentRunV1,
  type DelegationGrantV1
} from "@second-brain/contracts";

import { TerminalWorkerError } from "../../workers/worker-errors.js";

export function validateDelegationLineage(
  run: AgentRunV1,
  parent: AgentRunV1,
  grant: DelegationGrantV1,
  now: Date
): void {
  validateIdentity(run, parent, grant);
  validateScope(run, parent, grant);
  validateLifecycle(run, parent, grant, now);
  validateBudgets(run, parent, grant);
}

function validateIdentity(run: AgentRunV1, parent: AgentRunV1, grant: DelegationGrantV1): void {
  if (
    grant.id !== run.delegationGrantId ||
    grant.parentRunId !== parent.id ||
    parent.id !== run.parentRunId
  )
    throw new TerminalWorkerError("Delegation grant parent lineage does not match the run.");
  if (grant.childAgentId !== run.agentId)
    throw new TerminalWorkerError("Delegation grant child agent does not match the run.");
}

function validateScope(run: AgentRunV1, parent: AgentRunV1, grant: DelegationGrantV1): void {
  if (grant.workspaceId !== run.workspaceId || parent.workspaceId !== run.workspaceId)
    throw new TerminalWorkerError("Delegation workspace does not match the run.");
  if (
    !parent.platformPolicyDigest ||
    !parent.resourceDigest ||
    parent.platformPolicyDigest !== run.platformPolicyDigest ||
    parent.resourceDigest !== run.resourceDigest
  )
    throw new TerminalWorkerError(
      "Delegation parent release identity does not match the child run."
    );
  if (parent.rootRunId !== run.rootRunId)
    throw new TerminalWorkerError("Delegation parent and child belong to different root runs.");
}

function validateLifecycle(
  run: AgentRunV1,
  parent: AgentRunV1,
  grant: DelegationGrantV1,
  now: Date
): void {
  if (parent.status !== "running")
    throw new TerminalWorkerError("Delegation parent run is no longer active.");
  if (new Date(grant.expiresAt).getTime() <= now.getTime())
    throw new TerminalWorkerError("Delegation grant has expired.");
  if (run.deadlineAt !== grant.expiresAt)
    throw new TerminalWorkerError("Delegated run deadline does not match its grant expiry.");
  if (new Date(grant.expiresAt).getTime() > new Date(parent.deadlineAt).getTime())
    throw new TerminalWorkerError("Delegation grant outlives its parent run.");
}

function validateBudgets(run: AgentRunV1, parent: AgentRunV1, grant: DelegationGrantV1): void {
  if (
    run.timeoutSeconds > grant.timeoutSeconds ||
    tokenBudgetExceeds(run.tokenBudget, grant.tokenBudget)
  )
    throw new TerminalWorkerError("Delegated run exceeds its grant budget.");
  if (
    grant.timeoutSeconds > parent.timeoutSeconds ||
    tokenBudgetExceeds(grant.tokenBudget, parent.tokenBudget)
  )
    throw new TerminalWorkerError("Delegation grant exceeds its parent run budget.");
}
