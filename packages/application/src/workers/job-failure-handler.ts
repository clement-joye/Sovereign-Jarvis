import type { InternalJobV1 } from "@second-brain/contracts";
import type { ClockPort } from "@second-brain/domain";

import type { JobQueuePort } from "../ports.js";

type JobFailureQueue = Pick<JobQueuePort, "fail">;

export class JobFailureHandler {
  constructor(
    private readonly jobs: JobFailureQueue,
    private readonly clock: ClockPort,
    private readonly config: { workerId: string; retryBaseDelayMs: number; maxAttempts: number }
  ) {}

  fail(job: InternalJobV1, error: unknown): Promise<InternalJobV1> {
    return this.jobs.fail({
      jobId: job.id,
      leaseOwner: this.config.workerId,
      now: this.clock.now(),
      retryable: !(error instanceof Error && "retryable" in error && error.retryable === false),
      reason: error instanceof Error ? error.message : "Unknown worker error.",
      retryDelayMs: this.config.retryBaseDelayMs * 2 ** job.attempts,
      maxAttempts: this.config.maxAttempts
    });
  }
}
