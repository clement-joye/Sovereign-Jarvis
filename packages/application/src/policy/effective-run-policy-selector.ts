import type { EffectiveRunPolicyV2, PiRunRequestV1 } from "@second-brain/contracts";

import { TerminalWorkerError } from "../workers/worker-errors.js";

/** Selects the immutable snapshot issued for the exact outgoing run identity. */
export function selectEffectiveRunPolicy(
  policies: readonly EffectiveRunPolicyV2[] | undefined,
  request: Pick<PiRunRequestV1, "workspaceId" | "agentId">
): EffectiveRunPolicyV2 | undefined {
  if (policies === undefined) return undefined;
  const policy = policies.find(
    (candidate) =>
      candidate.workspaceId === request.workspaceId && candidate.agentId === request.agentId
  );
  if (!policy) {
    throw new TerminalWorkerError(
      `No effective run policy matches workspace ${request.workspaceId ?? "<unknown>"} and agent ${request.agentId ?? "<unknown>"}.`
    );
  }
  return policy;
}
