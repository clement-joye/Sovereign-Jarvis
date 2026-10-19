import type { ScheduledExecutionV1 } from "@second-brain/contracts";
import { requireWorkspaceId } from "@second-brain/domain";

import type { ExecutionRepositoryPort, SessionRepositoryPort } from "../../ports.js";
import type { ScheduleRepositoryPort } from "../../ports/scheduling.js";

export interface ScheduleAnchorBindingInput {
  /** Idempotency key of the synthetic anchor message, e.g. `run_schedule:execution-1:outbound:anchor`. */
  anchorIdempotencyKey: string;
  /** Matrix event id of the anchor message that was just sent. */
  anchorExternalEventId: string;
  /** Matrix conversation id the anchor + reply live in. */
  conversationId: string;
}

export interface ScheduleAnchorBindingResult {
  /** True when a session binding was created. False when the call was a no-op (unknown anchor, missing execution/session, etc.). */
  bound: boolean;
  /** Execution id parsed out of the anchor idempotency key, when valid. */
  executionId?: string;
}

export class ScheduleAnchorBinder {
  constructor(
    private readonly sessions: Pick<SessionRepositoryPort, "activateBinding" | "get">,
    private readonly executions: Pick<ExecutionRepositoryPort, "get">,
    private readonly schedules: Pick<ScheduleRepositoryPort, "get">
  ) {}

  async bind(input: ScheduleAnchorBindingInput): Promise<ScheduleAnchorBindingResult> {
    const executionId = parseScheduledExecutionId(input.anchorIdempotencyKey);
    if (!executionId) {
      return { bound: false };
    }
    const execution = await this.executions.get(executionId);
    if (!execution) {
      return { bound: false, executionId };
    }
    const schedule = await this.schedules.get(execution.scheduleId);
    if (!schedule) return { bound: false, executionId };
    const workspaceId = requireWorkspaceId(schedule.workspaceId, "Schedule anchor binding");
    const bound = await this.bindScheduleToAnchor(execution, input, workspaceId);
    return { bound, executionId };
  }

  private async bindScheduleToAnchor(
    execution: ScheduledExecutionV1,
    input: ScheduleAnchorBindingInput,
    workspaceId: string
  ): Promise<boolean> {
    if (!execution.sessionId) {
      return false;
    }
    const session = await this.sessions.get(execution.sessionId, workspaceId);
    if (!session) {
      return false;
    }
    await this.sessions.activateBinding({
      sessionId: session.id,
      workspaceId,
      conversationId: input.conversationId,
      threadRootExternalEventId: input.anchorExternalEventId
    });
    return true;
  }
}

/**
 * Pulls the execution id out of an anchor idempotency key built by
 * `threadAnchorMessage`. Returns `undefined` for any key that does not
 * match the `run_schedule:<executionId>:outbound:anchor` shape so we
 * silently ignore anchor messages that did not originate from a scheduled
 * job (the schedule handler is currently the only producer of
 * `threadAnchorText`).
 */
export function parseScheduledExecutionId(anchorIdempotencyKey: string): string | undefined {
  // Execution ids include an ISO timestamp, whose time component contains
  // colons (for example `...-2026-08-01T14:58:23.000Z`). Match the fixed
  // suffix rather than treating colons as an execution-id delimiter.
  const match = /^run_schedule:(.+):outbound:anchor$/.exec(anchorIdempotencyKey);
  return match?.[1];
}
