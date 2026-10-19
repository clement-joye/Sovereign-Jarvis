import type { ActionProposalV1 } from "@second-brain/contracts";

import { canonicalJson } from "./action-proposal-canonicalization.js";
import { ActionProposalConflictError } from "./action-proposal-errors.js";
import type { ActionProposalConsumeInput } from "./action-proposal-types.js";

export function assertSameProposalBinding(
  expected: ActionProposalV1,
  actual: ActionProposalV1
): void {
  const fields: Array<keyof ActionProposalV1> = [
    "workspaceId",
    "agentId",
    "runId",
    "pluginId",
    "capabilityId",
    "operationId",
    "operationVersion",
    "operationDigest",
    "summary",
    "idempotencyKey",
    "approvalMode",
    "requiredApprover",
    "expiresAt"
  ];
  for (const field of fields) {
    if (expected[field] !== actual[field]) {
      throw new ActionProposalConflictError(
        "Idempotency key is already bound to a different action proposal."
      );
    }
  }
  if (canonicalJson(expected.parameters) !== canonicalJson(actual.parameters)) {
    throw new ActionProposalConflictError(
      "Idempotency key is already bound to different action parameters."
    );
  }
}

export function assertConsumeBinding(
  proposal: ActionProposalV1,
  input: ActionProposalConsumeInput
): void {
  const fields: Array<keyof ActionProposalConsumeInput> = [
    "proposalId",
    "workspaceId",
    "agentId",
    "runId",
    "pluginId",
    "capabilityId",
    "operationId",
    "operationVersion",
    "operationDigest",
    "idempotencyKey"
  ];
  for (const field of fields) {
    const expected =
      field === "proposalId" ? proposal.id : proposal[field as keyof ActionProposalV1];
    if (expected !== input[field]) {
      throw new ActionProposalConflictError("Action proposal binding does not match exactly.");
    }
  }
}
