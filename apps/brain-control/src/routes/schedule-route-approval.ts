import type { ScheduleApprovalService } from "@second-brain/application";

import { mutationIdempotencyKey } from "./schedule-route-authorization.js";
import type { ScheduleRouteCall } from "./schedule-route-types.js";

type ScheduleProposalInput = Parameters<ScheduleApprovalService["propose"]>[0];

export async function proposeScheduleMutation(
  call: ScheduleRouteCall,
  mutation: Pick<ScheduleProposalInput, "operation" | "parameters">
): Promise<boolean> {
  if (!call.runAuthorization) return false;
  const { dependencies, request, response, runAuthorization } = call;
  const idempotencyKey = mutationIdempotencyKey(request);
  if (!dependencies.scheduleApprovals || !runAuthorization.agentId || !idempotencyKey) {
    dependencies.writeJson(response, 400, { error: "invalid_schedule_approval_context" });
    return true;
  }
  const pending = await dependencies.scheduleApprovals.propose({
    workspaceId: runAuthorization.workspaceId,
    agentId: runAuthorization.agentId,
    runId: runAuthorization.runId,
    expiresAt: runAuthorization.expiresAt,
    idempotencyKey,
    ...mutation
  });
  await dependencies.approvalPrompts?.publish(pending.proposal);
  dependencies.writeJson(response, 202, pending);
  return true;
}
