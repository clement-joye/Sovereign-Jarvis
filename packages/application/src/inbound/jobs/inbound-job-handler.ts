import type { InternalJobV1 } from "@second-brain/contracts";

import type { InboundJobCompletion } from "./inbound-job-completion.js";
import type { InboundMessageResolver } from "../turns/inbound-message-resolver.js";
import type { InboundTurnProcessor } from "../turns/inbound-turn-processor.js";

/** Coordinates an interactive inbound job from message lookup through durable completion. */
export class InboundJobHandler {
  constructor(
    private readonly messages: InboundMessageResolver,
    private readonly turns: InboundTurnProcessor,
    private readonly completion: InboundJobCompletion
  ) {}

  async process(job: InternalJobV1): Promise<void> {
    const message = await this.messages.resolve(job);
    const outboundKey = `process_inbound:${message.id}:outbound`;
    if (await this.completion.completeIfDelivered(job, outboundKey, message.workspaceId)) return;

    const outcome = await this.turns.process(job, message, outboundKey);
    if (outcome.kind === "cancelled") {
      await this.completion.complete(job);
      return;
    }
    await this.completion.createOutbound(job, outcome.outbound);
  }
}
