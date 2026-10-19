import type { AgentRunV1, InternalJobV1 } from "@second-brain/contracts";

import { TerminalWorkerError } from "../../workers/worker-errors.js";

export function terminal(
  run: AgentRunV1,
  status: AgentRunV1["status"],
  now: Date,
  resultText?: string
): AgentRunV1 {
  return {
    ...run,
    status,
    completedAt: now.toISOString(),
    ...(resultText ? { resultText } : {})
  };
}

export function assertExecutionIdentity(
  run: AgentRunV1,
  job: InternalJobV1,
  policy: NonNullable<InternalJobV1["effectiveRunPolicies"]>[number]
): void {
  if (
    !run.effectivePolicyDigest ||
    !run.platformPolicyDigest ||
    !run.resourceDigest ||
    !run.runtimeImageId
  ) {
    throw new TerminalWorkerError(
      "Agent run has no durable execution identity and cannot be executed."
    );
  }
  if (
    run.effectivePolicyDigest !== policy.policyDigest ||
    run.platformPolicyDigest !== policy.platformPolicyDigest ||
    run.resourceDigest !== policy.resourceDigest ||
    run.runtimeImageId !== policy.runtimeImageId
  ) {
    throw new TerminalWorkerError(
      "Agent run durable execution identity does not match its effective policy snapshot."
    );
  }
  if (
    job.payload.effectivePolicyDigest !== undefined &&
    job.payload.effectivePolicyDigest !== run.effectivePolicyDigest
  ) {
    throw new TerminalWorkerError("Agent run job effective policy does not match its durable run.");
  }
}
