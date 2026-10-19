import { describe, expect, it, vi } from "vitest";

import type { ScheduledExecutionV1, ScheduledJobV1 } from "@second-brain/contracts";

import { ScheduleNotificationPolicy } from "./schedule-notification-policy.js";

describe("ScheduleNotificationPolicy", () => {
  it("handles unconditional and failure-only notification policies without loading history", async () => {
    const history = { listBySchedule: vi.fn() };
    const policy = new ScheduleNotificationPolicy(history);

    await expect(policy.shouldNotify(schedule("never"), execution())).resolves.toBe(false);
    await expect(policy.shouldNotify(schedule("always"), execution())).resolves.toBe(true);
    await expect(
      policy.shouldNotify(schedule("on_failure"), execution({ status: "failed" }))
    ).resolves.toBe(true);
    await expect(policy.shouldNotify(schedule("on_failure"), execution())).resolves.toBe(false);
    expect(history.listBySchedule).not.toHaveBeenCalled();
  });

  it("notifies on change only when the latest successful fingerprint differs", async () => {
    const previous = execution({ id: "execution-previous", resultFingerprint: "same" });
    const history = { listBySchedule: vi.fn().mockResolvedValue([previous]) };
    const policy = new ScheduleNotificationPolicy(history);

    await expect(policy.shouldNotify(schedule("on_change"), execution())).resolves.toBe(false);
    await expect(
      policy.shouldNotify(schedule("on_change"), execution({ resultFingerprint: "changed" }))
    ).resolves.toBe(true);
  });
});

function schedule(notificationPolicy: ScheduledJobV1["notificationPolicy"]): ScheduledJobV1 {
  return {
    schemaVersion: 1,
    id: "schedule-1",
    agentId: "brain",
    name: "Daily summary",
    instruction: "Summarize the day.",
    schedule: { type: "cron", expression: "0 9 * * *", timezone: "Europe/Stockholm" },
    enabled: true,
    sessionPolicy: { type: "fresh" },
    notificationPolicy,
    overlapPolicy: "skip",
    missedRunPolicy: "skip",
    timeoutSeconds: 60,
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function execution(overrides: Partial<ScheduledExecutionV1> = {}): ScheduledExecutionV1 {
  return {
    schemaVersion: 1,
    id: "execution-current",
    scheduleId: "schedule-1",
    scheduledFor: "2026-01-01T09:00:00.000Z",
    status: "succeeded",
    attempt: 1,
    resultFingerprint: "same",
    createdAt: "2026-01-01T09:00:00.000Z",
    finishedAt: "2026-01-01T09:01:00.000Z",
    ...overrides
  };
}
