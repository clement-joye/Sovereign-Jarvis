import type { InternalJobV1, OutboundMessageV1 } from "@second-brain/contracts";
import type {
  OutboundResponseFactory,
  OutboundResponseInput
} from "./outbound-response-factory.js";
import type { JobQueuePort, OutboundJobCompletionPort } from "../ports.js";

/** Persists an idempotent outbound response and completes its leased job. */
export class OutboundJobCompleter {
  constructor(
    private readonly responses: OutboundResponseFactory,
    private readonly jobs: Pick<JobQueuePort, "complete">,
    private readonly workerId: string,
    private readonly outboundCompletions: OutboundJobCompletionPort | undefined
  ) {}

  outboundExists(idempotencyKey: string, workspaceId: string): Promise<boolean> {
    return this.responses
      .getByIdempotencyKey(idempotencyKey, workspaceId)
      .then((outbound) => Boolean(outbound));
  }

  async createAndComplete(
    job: InternalJobV1,
    input: OutboundResponseInput
  ): Promise<OutboundMessageV1> {
    const outbound = await this.responses.getOrBuild(input);
    if (this.outboundCompletions) {
      return this.outboundCompletions.createOutboundAndComplete({
        outbound,
        jobId: job.id,
        leaseOwner: this.workerId
      });
    }

    const created = await this.responses.create(outbound);
    await this.jobs.complete({ jobId: job.id, leaseOwner: this.workerId });
    return created;
  }
}
