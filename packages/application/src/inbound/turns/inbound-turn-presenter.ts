import type { InboundMessageV1, PiRunResultV1 } from "@second-brain/contracts";

import type { InboundCommandResponseHandler } from "../commands/inbound-command-response-handler.js";
import type { InboundJobCompletion } from "../jobs/inbound-job-completion.js";
import type { InboundPiResponseFactory } from "./inbound-pi-response-factory.js";
import type { SessionRoutingResult } from "../../sessions/routing/session-routing-result.js";

type OutboundCompletion = Parameters<InboundJobCompletion["createOutbound"]>[1];

export class InboundTurnPresenter {
  constructor(
    private readonly commands: Pick<InboundCommandResponseHandler, "create">,
    private readonly responses: Pick<InboundPiResponseFactory, "create">
  ) {}

  command(
    message: InboundMessageV1,
    outboundKey: string,
    routing: Extract<SessionRoutingResult, { kind: "command-response" }>
  ): Promise<OutboundCompletion> {
    return this.commands.create(message, outboundKey, routing);
  }

  piResult(
    message: InboundMessageV1,
    outboundKey: string,
    result: PiRunResultV1
  ): Promise<OutboundCompletion> {
    return this.responses.create({ message, outboundKey, result });
  }
}
