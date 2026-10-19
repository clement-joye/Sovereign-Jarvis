import type { InboundMessageV1 } from "@second-brain/contracts";
import {
  requireWorkspaceId,
  type ClockPort,
  type RoomAgentId,
  type SessionRecord
} from "@second-brain/domain";

import { numberedListPosition } from "../../shared/numbered-list-position.js";
import type { SessionRepositoryPort } from "../../ports.js";
import { displayLabel } from "../presentation/session-presentation.js";
import type { SessionRoutingResult } from "../routing/session-routing-result.js";

type CommandResponse = Extract<SessionRoutingResult, { kind: "command-response" }>;
type BindingInput = {
  workspaceId?: string;
  agentId?: RoomAgentId;
  conversationId: string;
  threadRootExternalEventId?: string;
};

/** Handles session activation, closure, and cancellation commands. */
export class SessionLifecycleCommandHandler {
  constructor(
    private readonly sessions: Pick<
      SessionRepositoryPort,
      "activateBinding" | "close" | "get" | "getActiveBinding" | "listRecent"
    >,
    private readonly clock: ClockPort,
    private readonly bindReplyThread: (
      message: InboundMessageV1,
      sessionId: string
    ) => Promise<void>
  ) {}

  async closeCurrent(message: InboundMessageV1): Promise<CommandResponse> {
    const session = await this.sessions.getActiveBinding(bindingKey(message));
    if (!session) {
      return {
        kind: "command-response",
        command: "close",
        text: "No active session to close."
      };
    }
    const closed = await this.sessions.close({
      sessionId: session.id,
      ...(message.workspaceId ? { workspaceId: message.workspaceId } : {}),
      now: this.clock.now()
    });
    return {
      kind: "command-response",
      command: "close",
      sessionId: closed.id,
      text: "Session closed."
    };
  }

  async closeSelected(message: InboundMessageV1, selectors: string[]): Promise<CommandResponse> {
    const positions = [...new Set(selectors.map(numberedListPosition))];
    if (positions.some((position) => position === undefined)) {
      return {
        kind: "command-response",
        command: "close",
        presentation: "error",
        text: "Use `/sessions` to find a number, then `/close <number> [number ...]`."
      };
    }
    const sessions = await this.recentSessions(message, 10, false);
    const selected = positions.map((position) => sessions[position! - 1]);
    const missing = positions.filter((position, index) => !selected[index]);
    if (missing.length > 0) {
      return {
        kind: "command-response",
        command: "close",
        presentation: "error",
        text: `No active session found for number${missing.length === 1 ? "" : "s"} ${missing.join(", ")}.`
      };
    }
    const now = this.clock.now();
    const closed = await Promise.all(
      selected.map((session) =>
        this.sessions.close({
          sessionId: session!.id,
          ...(message.workspaceId ? { workspaceId: message.workspaceId } : {}),
          now
        })
      )
    );
    return {
      kind: "command-response",
      command: "close",
      ...(closed.length === 1 ? { sessionId: closed[0]!.id } : {}),
      text:
        closed.length === 1
          ? "Session closed."
          : [
              `Closed ${closed.length} sessions:`,
              ...closed.map((session) => `• ${displayLabel(session)}`)
            ].join("\n")
    };
  }

  async closeAll(message: InboundMessageV1): Promise<CommandResponse> {
    const now = this.clock.now();
    const active = (await this.recentSessions(message, 1000, true)).filter(
      (session) => session.status === "active" || session.status === "idle"
    );
    await Promise.all(
      active.map((session) =>
        this.sessions.close({
          sessionId: session.id,
          ...(message.workspaceId ? { workspaceId: message.workspaceId } : {}),
          now
        })
      )
    );
    return {
      kind: "command-response",
      command: "close-all",
      text:
        active.length === 0
          ? "No active sessions to close."
          : `Closed ${active.length} active session${active.length === 1 ? "" : "s"}.`
    };
  }

  async cancel(_message: InboundMessageV1): Promise<CommandResponse> {
    return {
      kind: "command-response",
      command: "cancel",
      text: "Cancellation requested."
    };
  }

  private recentSessions(
    message: InboundMessageV1,
    limit: number,
    includeClosed: boolean
  ): Promise<SessionRecord[]> {
    return this.sessions.listRecent({
      workspaceId: requireWorkspaceId(message.workspaceId, "Session command"),
      now: this.clock.now(),
      limit,
      includeClosed
    });
  }
}

function bindingKey(message: InboundMessageV1): BindingInput {
  return {
    ...(message.workspaceId ? { workspaceId: message.workspaceId } : {}),
    ...(message.agentId ? { agentId: message.agentId } : {}),
    conversationId: message.conversationId,
    ...(message.threadRootExternalEventId
      ? { threadRootExternalEventId: message.threadRootExternalEventId }
      : {})
  };
}
