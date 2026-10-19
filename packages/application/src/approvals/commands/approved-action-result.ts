import {
  ScheduleMutationResultV1Schema,
  ScheduledExecutionV1Schema,
  ScheduledJobV1Schema,
  type ActionProposalV1,
  type ScheduledJobV1
} from "@second-brain/contracts";

/** Keeps internal execution records out of owner-facing approval confirmations. */
export function approvedActionResult(proposal: ActionProposalV1, result: unknown): string {
  if (proposal.pluginId === "schedule-control") {
    return scheduleResult(proposal, result);
  }
  const detail = formatSafeResult(result);
  return [
    "**Approved action completed**",
    "",
    proposal.summary,
    ...(detail ? ["", detail] : [])
  ].join("\n");
}

function scheduleResult(proposal: ActionProposalV1, result: unknown): string {
  if (proposal.operationId === "schedule-create" || proposal.operationId === "schedule-update") {
    const parsed = ScheduleMutationResultV1Schema.safeParse(result);
    if (!parsed.success) return completedSummary(proposal);
    const schedule = parsed.data.schedule;
    const heading = proposal.operationId === "schedule-create" ? "created" : "updated";
    return [
      `**Schedule ${heading}**`,
      "",
      `${schedule.name} · @${schedule.agentId}`,
      scheduleStatus(schedule)
    ].join("\n");
  }
  if (proposal.operationId === "schedule-delete") {
    const parsed = ScheduledJobV1Schema.safeParse(result);
    return parsed.success
      ? ["**Schedule deleted**", "", parsed.data.name].join("\n")
      : completedSummary(proposal);
  }
  if (proposal.operationId === "schedule-run-now") {
    const parsed = ScheduledExecutionV1Schema.safeParse(result);
    return parsed.success
      ? ["**Schedule run queued**", "", proposal.summary].join("\n")
      : completedSummary(proposal);
  }
  return completedSummary(proposal);
}

function scheduleStatus(schedule: ScheduledJobV1): string {
  if (!schedule.enabled) return "Paused";
  if (!schedule.nextRunAt) return "No upcoming run";
  const iso = new Date(schedule.nextRunAt).toISOString();
  return `Next run: ${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function completedSummary(proposal: ActionProposalV1): string {
  return ["**Approved action completed**", "", proposal.summary].join("\n");
}

function formatSafeResult(value: unknown): string | undefined {
  const detail =
    typeof value === "string"
      ? value
      : typeof value === "object" && value !== null && "summary" in value
        ? value.summary
        : undefined;
  if (typeof detail !== "string" || !detail.trim()) return undefined;
  return detail.length <= 2_000 ? detail : `${detail.slice(0, 1_997)}...`;
}
