import { describe, expect, it } from "vitest";

import type { InternalJobV1 } from "@second-brain/contracts";

import { InMemoryJobQueue } from "../index.js";

describe("InMemoryJobQueue root admission", () => {
  it("bounds roots while admitting deterministic commands and descendants", async () => {
    const queue = new InMemoryJobQueue();
    await queue.enqueue(job("root-a"));
    await queue.enqueue(job("root-b"));
    const admission = { limit: 1, leaseMs: 90_000 };
    const now = new Date("2026-09-12T10:00:00.000Z");

    const first = await queue.claim({
      workerId: "root-worker",
      limit: 1,
      now,
      leaseMs: 90_000,
      rootAdmission: admission
    });
    expect(first).toMatchObject([{ id: "root-a" }]);
    await expect(
      queue.claim({
        workerId: "other-worker",
        limit: 1,
        now,
        leaseMs: 90_000,
        rootAdmission: admission
      })
    ).resolves.toEqual([]);

    await queue.enqueue(
      job("command", { payload: { requiresRootAdmission: false }, priority: 200 })
    );
    await expect(
      queue.claim({
        workerId: "command-worker",
        limit: 1,
        now,
        leaseMs: 90_000,
        rootAdmission: admission
      })
    ).resolves.toMatchObject([{ id: "command" }]);

    await queue.enqueue(
      job("child", {
        type: "run_agent",
        payload: { runId: "child", rootRunId: "root-a" },
        priority: 300
      })
    );
    await expect(
      queue.claim({
        workerId: "child-worker",
        limit: 1,
        now,
        leaseMs: 90_000,
        rootAdmission: admission
      })
    ).resolves.toMatchObject([{ id: "child" }]);

    await queue.complete({ jobId: "root-a", leaseOwner: "root-worker" });
    await expect(queue.admissionSnapshot(1, now)).resolves.toMatchObject({ activeRoots: 1 });
    await expect(
      queue.claim({
        workerId: "next-worker",
        limit: 1,
        now,
        leaseMs: 90_000,
        rootAdmission: admission
      })
    ).resolves.toEqual([]);
    await queue.complete({ jobId: "child", leaseOwner: "child-worker" });
    await expect(
      queue.claim({
        workerId: "next-worker",
        limit: 1,
        now,
        leaseMs: 90_000,
        rootAdmission: admission
      })
    ).resolves.toMatchObject([{ id: "root-b" }]);
  });

  it("does not revive an expired admission while its job lease is still live", async () => {
    const queue = new InMemoryJobQueue();
    const now = new Date("2026-09-12T10:00:00.000Z");
    await queue.enqueue(job("root"));
    await queue.claim({
      workerId: "worker",
      limit: 1,
      now,
      leaseMs: 120_000,
      rootAdmission: { limit: 1, leaseMs: 90_000 }
    });

    await expect(
      queue.renew({
        jobId: "root",
        leaseOwner: "worker",
        now: new Date(now.getTime() + 91_000),
        leaseMs: 120_000,
        admissionLeaseMs: 90_000
      })
    ).resolves.toBe(false);
    expect(queue.snapshot()[0]?.leaseExpiresAt).toBe(
      new Date(now.getTime() + 120_000).toISOString()
    );
  });

  it("cancels a queued root without admitting it", async () => {
    const queue = new InMemoryJobQueue();
    await queue.enqueue(job("queued"));
    await expect(
      queue.cancelRootRun({ rootRunId: "queued", now: new Date(), reason: "cancelled_by_control" })
    ).resolves.toBe(1);
    expect(queue.snapshot()).toMatchObject([{ id: "queued", status: "cancelled" }]);
  });
});

function job(id: string, overrides: Partial<InternalJobV1> = {}): InternalJobV1 {
  return {
    schemaVersion: 1,
    id,
    workspaceId: "workspace-example",
    type: "process_inbound",
    payload: { requiresRootAdmission: true },
    priority: 100,
    status: "pending",
    attempts: 0,
    availableAt: "2026-09-12T09:00:00.000Z",
    idempotencyKey: id,
    ...overrides
  };
}
