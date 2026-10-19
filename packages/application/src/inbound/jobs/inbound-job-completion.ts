import type { InternalJobV1 } from "@second-brain/contracts";
import { requireWorkspaceId } from "@second-brain/domain";

import type { OutboundJobCompleter } from "../../outbound/outbound-job-completer.js";
import type { JobQueuePort } from "../../ports.js";

type OutboundCompletion = Parameters<OutboundJobCompleter["createAndComplete"]>[1];

export class InboundJobCompletion {
  constructor(
    private readonly outbounds: Pick<OutboundJobCompleter, "outboundExists" | "createAndComplete">,
    private readonly jobs: Pick<JobQueuePort, "complete">,
    private readonly workerId: string
  ) {}

  async completeIfDelivered(
    job: InternalJobV1,
    outboundKey: string,
    workspaceId: string | undefined
  ): Promise<boolean> {
    if (!(await this.outbounds.outboundExists(outboundKey, requireWorkspaceId(workspaceId)))) {
      return false;
    }
    await this.complete(job);
    return true;
  }

  createOutbound(job: InternalJobV1, outbound: OutboundCompletion): Promise<unknown> {
    return this.outbounds.createAndComplete(job, outbound);
  }

  complete(job: InternalJobV1): Promise<void> {
    return this.jobs.complete({ jobId: job.id, leaseOwner: this.workerId });
  }
}
