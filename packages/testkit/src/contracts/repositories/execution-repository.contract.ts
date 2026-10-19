import { beforeEach, describe, expect, it } from "vitest";

import type { ExecutionRepositoryPort } from "@second-brain/application";
import type { ScheduledExecutionV1 } from "@second-brain/contracts";

export interface ExecutionRepositoryContractSubject {
  name: string;
  beforeEach?(): Promise<void> | void;
  create(): ExecutionRepositoryPort;
}

export function executionRepositoryContract(subject: ExecutionRepositoryContractSubject): void {
  describe(`${subject.name} execution repository contract`, () => {
    beforeEach(async () => {
      await subject.beforeEach?.();
    });

    it("deduplicates executions and finds active executions by schedule", async () => {
      const repository = subject.create();
      const first = execution({ id: "execution-1" });

      await expect(repository.create(first)).resolves.toEqual({
        execution: first,
        duplicate: false
      });
      await expect(repository.create({ ...first })).resolves.toMatchObject({
        execution: { id: "execution-1" },
        duplicate: true
      });
      await expect(repository.findActiveBySchedule("schedule-1")).resolves.toMatchObject({
        id: "execution-1",
        status: "queued"
      });
      await expect(
        repository.update({ ...first, status: "succeeded", finishedAt: "2026-07-17T16:01:00.000Z" })
      ).resolves.toMatchObject({ status: "succeeded" });
      await expect(repository.findActiveBySchedule("schedule-1")).resolves.toBeUndefined();
    });
  });
}

function execution(overrides: Partial<ScheduledExecutionV1> = {}): ScheduledExecutionV1 {
  return {
    schemaVersion: 1,
    id: "execution-1",
    scheduleId: "schedule-1",
    scheduledFor: "2026-07-17T16:00:00.000Z",
    status: "queued",
    attempt: 0,
    createdAt: "2026-07-17T15:00:00.000Z",
    ...overrides
  };
}
