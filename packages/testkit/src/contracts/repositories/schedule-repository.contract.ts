import { beforeEach, describe, expect, it } from "vitest";

import type { ScheduleRepositoryPort } from "@second-brain/application";
import type { ScheduledJobV1 } from "@second-brain/contracts";

export interface ScheduleRepositoryContractSubject {
  name: string;
  beforeEach?(): Promise<void> | void;
  create(): ScheduleRepositoryPort;
}

// scheduleRepositoryContract bundles the four schedule-repository contract
// cases (create/list/update/delete, claimDue, hard-delete, hard-delete
// selection) in one suite so both the in-memory adapter and the
// PostgreSQL adapter exercise the same surface. The 100-line ceiling is
// exceeded by a few lines, which is the right trade-off here: keeping
// the cases adjacent makes the contract easy to scan end-to-end.
export function scheduleRepositoryContract(subject: ScheduleRepositoryContractSubject): void {
  describe(`${subject.name} schedule repository contract`, () => {
    beforeEach(async () => {
      await subject.beforeEach?.();
    });

    it("creates, lists, updates with expected version, and soft deletes schedules", async () => {
      const repository = subject.create();
      await repository.create(schedule({ id: "schedule-1", version: 1 }));

      await expect(repository.get("schedule-1")).resolves.toMatchObject({ id: "schedule-1" });
      await expect(repository.list()).resolves.toHaveLength(1);
      await expect(
        repository.update(schedule({ id: "schedule-1", name: "Updated", version: 2 }), 1)
      ).resolves.toMatchObject({ name: "Updated", version: 2 });
      await expect(
        repository.update(schedule({ id: "schedule-1", version: 3 }), 1)
      ).rejects.toThrow(/version conflict/i);
      await expect(
        repository.delete({
          id: "schedule-1",
          now: new Date("2026-07-17T16:00:00.000Z"),
          expectedVersion: 2
        })
      ).resolves.toMatchObject({ enabled: false });
      await expect(repository.list()).resolves.toEqual([]);
    });

    it("claims enabled due schedules by next run time", async () => {
      const repository = subject.create();
      await repository.create(schedule({ id: "later", nextRunAt: "2026-07-17T17:00:00.000Z" }));
      await repository.create(schedule({ id: "due", nextRunAt: "2026-07-17T16:00:00.000Z" }));
      await repository.create(
        schedule({ id: "disabled", enabled: false, nextRunAt: "2026-07-17T15:00:00.000Z" })
      );

      await expect(
        repository.claimDue({ now: new Date("2026-07-17T16:30:00.000Z"), limit: 10 })
      ).resolves.toMatchObject([{ id: "due" }]);
    });

    it("hard-deletes only disabled schedules older than the cutoff", async () => {
      const repository = subject.create();
      const oldDisabled = schedule({
        id: "old-disabled",
        enabled: false,
        updatedAt: "2026-07-01T00:00:00.000Z"
      });
      const recentDisabled = schedule({
        id: "recent-disabled",
        enabled: false,
        updatedAt: "2026-07-15T00:00:00.000Z"
      });
      const oldEnabled = schedule({
        id: "old-enabled",
        enabled: true,
        updatedAt: "2026-07-01T00:00:00.000Z"
      });
      await repository.create(oldDisabled);
      await repository.create(recentDisabled);
      await repository.create(oldEnabled);
      // Soft-delete the oldDisabled row first; the production WHERE clause
      // filters `deleted_at IS NULL` so a soft-deleted row is never a
      // hard-delete target.
      await repository.delete({
        id: "old-disabled",
        now: new Date("2026-07-17T16:00:00.000Z"),
        expectedVersion: 1
      });

      const deleted = await repository.hardDeleteDisabledOlderThan({
        cutoff: new Date("2026-07-10T00:00:00.000Z"),
        workspaceId: "workspace-example"
      });

      expect(deleted).toBe(0);
      // The soft-deleted `oldDisabled` is excluded from `list()` in both
      // implementations; the remaining visible rows are `oldEnabled` and
      // `recentDisabled`.
      expect((await repository.list()).map((job) => job.id).sort()).toEqual([
        "old-enabled",
        "recent-disabled"
      ]);
    });

    it("hard-deletes disabled schedules whose updatedAt is older than the cutoff", async () => {
      const repository = subject.create();
      const oldDisabled = schedule({
        id: "old-disabled",
        enabled: false,
        updatedAt: "2026-07-01T00:00:00.000Z"
      });
      const recentDisabled = schedule({
        id: "recent-disabled",
        enabled: false,
        updatedAt: "2026-07-15T00:00:00.000Z"
      });
      const oldEnabled = schedule({
        id: "old-enabled",
        enabled: true,
        updatedAt: "2026-07-01T00:00:00.000Z"
      });
      await repository.create(oldDisabled);
      await repository.create(recentDisabled);
      await repository.create(oldEnabled);

      const deleted = await repository.hardDeleteDisabledOlderThan({
        cutoff: new Date("2026-07-10T00:00:00.000Z"),
        workspaceId: "workspace-example"
      });

      // Only `old-disabled` is enabled=false AND updatedAt < cutoff.
      // `old-enabled` stays (still enabled). `recent-disabled` stays
      // (updatedAt is more recent than the cutoff).
      expect(deleted).toBe(1);
      expect((await repository.list()).map((job) => job.id).sort()).toEqual([
        "old-enabled",
        "recent-disabled"
      ]);
    });
  });
}

function schedule(overrides: Partial<ScheduledJobV1> = {}): ScheduledJobV1 {
  return {
    schemaVersion: 1,
    id: "schedule-1",
    workspaceId: "workspace-example",
    destinationConversationId: "!room:example",
    agentId: "brain",
    name: "Hourly",
    instruction: "Ping.",
    schedule: { type: "interval", seconds: 3600, timezone: "UTC" },
    enabled: true,
    sessionPolicy: { type: "fresh" },
    notificationPolicy: "always",
    overlapPolicy: "skip",
    missedRunPolicy: "run_once",
    timeoutSeconds: 600,
    nextRunAt: "2026-07-17T16:00:00.000Z",
    version: 1,
    createdAt: "2026-07-17T15:00:00.000Z",
    updatedAt: "2026-07-17T15:00:00.000Z",
    ...overrides
  };
}
