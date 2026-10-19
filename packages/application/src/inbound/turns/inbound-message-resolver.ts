import type { InboundMessageV1, InternalJobV1 } from "@second-brain/contracts";

import type { InboundMessageRepositoryPort } from "../../ports.js";
import { TerminalWorkerError } from "../../workers/worker-errors.js";
import { requireStringJobPayload } from "../../workers/worker-job-input.js";

export class InboundMessageResolver {
  constructor(private readonly messages: Pick<InboundMessageRepositoryPort, "get">) {}

  async resolve(job: InternalJobV1): Promise<InboundMessageV1> {
    const inboundMessageId = requireStringJobPayload(job, "inboundMessageId");
    const message = await this.messages.get(inboundMessageId);
    if (!message) throw new TerminalWorkerError(`Unknown inbound message: ${inboundMessageId}`);
    return message;
  }
}
