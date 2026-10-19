import { beforeEach, describe, expect, it } from "vitest";
import type { InternalJobV1 } from "@second-brain/contracts";
import type { JobQueuePort } from "@second-brain/application";

export interface JobQueueContractSubject {
  name: string;
  beforeEach?(): Promise<void> | void;
  create(): JobQueuePort;
}

// jobQueueContract is the canonical contract test suite for every job
// queue implementation. Splitting the suite across files would scatter
// the per-state contract assertions; the file is the contract.
// eslint-disable-next-line max-lines-per-function
export function jobQueueContract(subject: JobQueueContractSubject): void {
  // eslint-disable-next-line max-lines-per-function
  describe(`${subject.name} job queue contract`, () => {
    beforeEach(async () => {
      await subject.beforeEach?.();
    });

    it("deduplicates by idempotency key", async () => {
      const queue = subject.create();
      const first = sampleJob({ id: "job-1", idempotencyKey: "same" });
      const second = sampleJob({ id: "job-2", idempotencyKey: "same" });

      await expect(queue.enqueue(first)).resolves.toEqual(first);
      await expect(queue.enqueue(second)).resolves.toEqual(first);
    });

    it("does not deduplicate matching idempotency keys across workspaces", async () => {
      const queue = subject.create();
      const workspaceOne = sampleJob({
        id: "job-workspace-one",
        workspaceId: "workspace-one",
        idempotencyKey: "same"
      });
      const workspaceTwo = sampleJob({
        id: "job-workspace-two",
        workspaceId: "workspace-two",
        idempotencyKey: "same"
      });

      await expect(queue.enqueue(workspaceOne)).resolves.toEqual(workspaceOne);
      await expect(queue.enqueue(workspaceTwo)).resolves.toEqual(workspaceTwo);
    });

    it("claims available jobs by priority", async () => {
      const queue = subject.create();
      await queue.enqueue(sampleJob({ id: "low", priority: 10, idempotencyKey: "low" }));
      await queue.enqueue(sampleJob({ id: "high", priority: 100, idempotencyKey: "high" }));

      const claimed = await queue.claim({
        workerId: "worker-1",
        limit: 1,
        now: new Date("2026-07-17T15:00:00.000Z"),
        leaseMs: 30_000
      });

      expect(claimed.map((job) => job.id)).toEqual(["high"]);
    });

    it("claims only the requested job types", async () => {
      const queue = subject.create();
      await queue.enqueue(sampleJob({ id: "inbound", idempotencyKey: "inbound" }));
      await queue.enqueue(sampleJob({ id: "agent", idempotencyKey: "agent", type: "run_agent" }));

      const claimed = await queue.claim({
        workerId: "delegation-worker",
        limit: 10,
        now: new Date("2026-07-17T15:00:00.000Z"),
        leaseMs: 30_000,
        jobTypes: ["run_agent"]
      });

      expect(claimed.map((job) => job.id)).toEqual(["agent"]);
    });

    it("requires the active lease owner to complete a job", async () => {
      const queue = subject.create();
      await queue.enqueue(sampleJob({ id: "job-1", idempotencyKey: "job-1" }));
      await queue.claim({
        workerId: "worker-1",
        limit: 1,
        now: new Date("2026-07-17T15:00:00.000Z"),
        leaseMs: 30_000
      });

      await expect(queue.complete({ jobId: "job-1", leaseOwner: "worker-2" })).rejects.toThrow(
        /lease owner/
      );
      await expect(
        queue.complete({ jobId: "job-1", leaseOwner: "worker-1" })
      ).resolves.toBeUndefined();
    });

    it("recovers expired leases for another worker", async () => {
      const queue = subject.create();
      await queue.enqueue(sampleJob({ id: "job-1", idempotencyKey: "job-1" }));
      await queue.claim({
        workerId: "worker-1",
        limit: 1,
        now: new Date("2026-07-17T15:00:00.000Z"),
        leaseMs: 30_000
      });

      await expect(
        queue.claim({
          workerId: "worker-2",
          limit: 1,
          now: new Date("2026-07-17T15:00:10.000Z"),
          leaseMs: 30_000
        })
      ).resolves.toEqual([]);
      await expect(
        queue.claim({
          workerId: "worker-2",
          limit: 1,
          now: new Date("2026-07-17T15:00:31.000Z"),
          leaseMs: 30_000
        })
      ).resolves.toMatchObject([{ id: "job-1", leaseOwner: "worker-2" }]);
    });

    it("moves retryable failures back to the queue after delay", async () => {
      const queue = subject.create();
      await queue.enqueue(sampleJob({ id: "job-1", idempotencyKey: "job-1" }));
      await queue.claim({
        workerId: "worker-1",
        limit: 1,
        now: new Date("2026-07-17T15:00:00.000Z"),
        leaseMs: 30_000
      });

      await queue.fail({
        jobId: "job-1",
        leaseOwner: "worker-1",
        now: new Date("2026-07-17T15:00:01.000Z"),
        retryable: true,
        reason: "dependency unavailable",
        retryDelayMs: 10_000,
        maxAttempts: 3
      });

      await expect(
        queue.claim({
          workerId: "worker-2",
          limit: 1,
          now: new Date("2026-07-17T15:00:05.000Z"),
          leaseMs: 30_000
        })
      ).resolves.toEqual([]);
      await expect(
        queue.claim({
          workerId: "worker-2",
          limit: 1,
          now: new Date("2026-07-17T15:00:11.000Z"),
          leaseMs: 30_000
        })
      ).resolves.toMatchObject([{ id: "job-1", attempts: 1, leaseOwner: "worker-2" }]);
    });

    it("dead-letters terminal failures", async () => {
      const queue = subject.create();
      await queue.enqueue(sampleJob({ id: "job-1", idempotencyKey: "job-1" }));
      await queue.claim({
        workerId: "worker-1",
        limit: 1,
        now: new Date("2026-07-17T15:00:00.000Z"),
        leaseMs: 30_000
      });

      const failed = await queue.fail({
        jobId: "job-1",
        leaseOwner: "worker-1",
        now: new Date("2026-07-17T15:00:01.000Z"),
        retryable: false,
        reason: "validation failed",
        maxAttempts: 3
      });

      expect(failed.status).toBe("dead_letter");
      await expect(
        queue.claim({
          workerId: "worker-2",
          limit: 1,
          now: new Date("2026-07-17T15:00:11.000Z"),
          leaseMs: 30_000
        })
      ).resolves.toEqual([]);
    });
  });
}

function sampleJob(overrides: Partial<InternalJobV1>): InternalJobV1 {
  return {
    schemaVersion: 1,
    id: "job",
    type: "process_inbound",
    payload: {},
    priority: 100,
    status: "pending",
    attempts: 0,
    availableAt: "2026-07-17T14:00:00.000Z",
    idempotencyKey: "job",
    workspaceId: "workspace-example",
    ...overrides
  };
}
