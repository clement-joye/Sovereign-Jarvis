import type { InboundMessageV1 } from "@second-brain/contracts";

import type { OutboundResponseInput } from "../../outbound/outbound-response-factory.js";
import type { SessionRoutingResult } from "../../sessions/routing/session-routing-result.js";

type CommandResponse = Extract<SessionRoutingResult, { kind: "command-response" }>;

/** Applies command side effects and builds the corresponding threaded reply. */
export class InboundCommandResponseHandler {
  async create(
    message: InboundMessageV1,
    outboundKey: string,
    routing: CommandResponse
  ): Promise<OutboundResponseInput> {
    const threadRootExternalEventId = message.threadRootExternalEventId ?? message.externalEventId;
    return {
      idempotencyKey: outboundKey,
      traceId: message.traceId,
      conversationId: message.conversationId,
      ...(message.workspaceId ? { workspaceId: message.workspaceId } : {}),
      text: routing.text,
      presentation: routing.presentation ?? commandPresentation(routing.command),
      replyToExternalEventId: threadRootExternalEventId,
      threadRootExternalEventId
    };
  }
}

function commandPresentation(command: CommandResponse["command"]): "notice" | "error" {
  return command === "invalid" || command === "not-command" ? "error" : "notice";
}
