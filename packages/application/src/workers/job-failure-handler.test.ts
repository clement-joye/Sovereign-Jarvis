import { describe, expect, it, vi } from "vitest";

import type { InternalJobV1 } from "@second-brain/contracts";
import type { ClockPort } from "@second-brain/domain";

import { JobFailureHandler } from "./job-failure-handler.js";

describe("JobFailureHandler", () => {
  it("records non-retryable errors without changing exponential backoff", async () => {
    const jobs = { fail: vi.fn().mockResolvedValue(job()) };
    const handler = new JobFailureHandler(jobs, fixedClock, config);
    const error = Object.assign(new Error("invalid request"), { retryable: false });

    await handler.fail(job({ attempts: 2 }), error);

    expect(jobs.fail).toHaveBeenCalledWith({
      jobId: "job-1",
      leaseOwner: "worker-1",
      now: fixedClock.now(),
      retryable: false,
      reason: "invalid request",
      retryDelayMs: 4_000,
      maxAttempts: 5
    });
  });

  it("uses a retryable unknown-error fallback", async () => {
    const jobs = { fail: vi.fn().mockResolvedValue(job()) };
    const handler = new JobFailureHandler(jobs, fixedClock, config);

    await handler.fail(job(), "unexpected failure");

    expect(jobs.fail).toHaveBeenCalledWith({
      jobId: "job-1",
      leaseOwner: "worker-1",
      now: fixedClock.now(),
      retryable: true,
      reason: "Unknown worker error.",
      retryDelayMs: 1_000,
      maxAttempts: 5
    });
  });
});

const fixedClock: ClockPort = {
  now: () => new Date("2026-07-27T10:00:00.000Z")
};

const config = { workerId: "worker-1", retryBaseDelayMs: 1_000, maxAttempts: 5 };

function job(overrides: Partial<InternalJobV1> = {}): InternalJobV1 {
  return {
    schemaVersion: 1,
    id: "job-1",
    type: "process_inbound",
    payload: {},
    priority: 100,
    status: "leased",
    attempts: 0,
    availableAt: "2026-07-27T10:00:00.000Z",
    idempotencyKey: "job-1",
    ...overrides
  };
}
