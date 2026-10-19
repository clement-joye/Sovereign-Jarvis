import type { ScheduledExecutionV1, ScheduledJobV1 } from "@second-brain/contracts";

import type { ExecutionRepositoryPort } from "../../ports.js";

type ScheduleExecutionHistory = Pick<ExecutionRepositoryPort, "listBySchedule">;

/** Decides whether a completed scheduled execution should create an outbound notification. */
export class ScheduleNotificationPolicy {
  constructor(private readonly executions: ScheduleExecutionHistory) {}

  async shouldNotify(schedule: ScheduledJobV1, execution: ScheduledExecutionV1): Promise<boolean> {
    if (schedule.notificationPolicy === "never") return false;
    if (schedule.notificationPolicy === "always") return true;
    if (schedule.notificationPolicy === "on_failure") return execution.status !== "succeeded";

    const history = await this.executions.listBySchedule(schedule.id);
    const previous = history
      .filter((candidate) => candidate.id !== execution.id)
      .filter((candidate) => candidate.status === "succeeded")
      .at(-1);
    return previous?.resultFingerprint !== execution.resultFingerprint;
  }
}
