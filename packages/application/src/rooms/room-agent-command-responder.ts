import type { InboundMessageV1, OutboundMessageV1 } from "@second-brain/contracts";
import type { IdGeneratorPort } from "@second-brain/domain";

import type { OutboundRepositoryPort } from "../ports.js";

/** Persists the system response emitted by a room-agent command. */
export class RoomAgentCommandResponder {
  constructor(
    private readonly outbounds: Pick<OutboundRepositoryPort, "create">,
    private readonly ids: IdGeneratorPort
  ) {}

  respond(message: InboundMessageV1, text: string): Promise<OutboundMessageV1> {
    return this.outbounds.create({
      schemaVersion: 1,
      id: this.ids.nextId("outbound"),
      traceId: message.traceId,
      workspaceId: message.workspaceId,
      conversationId: message.conversationId,
      text,
      images: [],
      replyToExternalEventId: message.externalEventId,
      threadRootExternalEventId: message.threadRootExternalEventId ?? message.externalEventId,
      presentation: "notice",
      urgency: "normal",
      idempotencyKey: `${message.workspaceId}:${message.externalEventId}:agent-command`
    });
  }
}
