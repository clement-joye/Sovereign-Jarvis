import type { InboundMessageV1 } from "@second-brain/contracts";

import type { SessionRepositoryPort } from "../../ports.js";
import { displayLabel, formatSessionList } from "../presentation/session-presentation.js";
import type { SessionRoutingResult } from "../routing/session-routing-result.js";
import type { SessionRecordFactory } from "../presentation/session-record-factory.js";

type CommandResponse = Extract<SessionRoutingResult, { kind: "command-response" }>;

/** Handles creation and presentation commands for conversational sessions. */
export class SessionOverviewCommandHandler {
  constructor(
    private readonly sessions: Pick<SessionRepositoryPort, "createAndBind" | "listRecent">,
    private readonly records: SessionRecordFactory,
    private readonly now: () => Date,
    private readonly bindReplyThread: (
      message: InboundMessageV1,
      sessionId: string
    ) => Promise<void>
  ) {}

  async create(message: InboundMessageV1, label: string | undefined): Promise<CommandResponse> {
    const session = this.records.create(message, label);

    await this.sessions.createAndBind({
      session,
      ...(message.workspaceId ? { workspaceId: message.workspaceId } : {}),
      conversationId: message.conversationId,
      ...optionalThread(message)
    });
    await this.bindReplyThread(message, session.id);
    return {
      kind: "command-response",
      command: "new",
      text: `New session: ${displayLabel(session)}`,
      sessionId: session.id
    };
  }

  async list(message: InboundMessageV1): Promise<CommandResponse> {
    const sessions = await this.sessions.listRecent({
      ...(message.workspaceId ? { workspaceId: message.workspaceId } : {}),
      now: this.now(),
      limit: 10,
      includeClosed: false
    });
    return { kind: "command-response", command: "sessions", text: formatSessionList(sessions) };
  }
}

function optionalThread(message: InboundMessageV1): { threadRootExternalEventId?: string } {
  return message.threadRootExternalEventId
    ? { threadRootExternalEventId: message.threadRootExternalEventId }
    : {};
}
