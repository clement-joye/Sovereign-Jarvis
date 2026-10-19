import type { InboundMessageV1 } from "@second-brain/contracts";
import type { AgentCatalog, CommandDecision } from "@second-brain/domain";

import type {
  ConversationPreferencePort,
  ConversationPreferenceScope,
  SessionRepositoryPort
} from "../../ports.js";
import type { SessionOverviewCommandHandler } from "./session-overview-command-handler.js";
import type { SessionRoutingResult } from "../routing/session-routing-result.js";

type SessionContextCommand = Extract<
  CommandDecision,
  { type: "session-fresh" | "session-history" | "session-default" | "session-status" }
>;

/** Owns user overrides for Pi session continuity and injected Matrix history. */
export class SessionContextCommandHandler {
  constructor(
    private readonly preferences: ConversationPreferencePort | undefined,
    private readonly sessions: Pick<SessionRepositoryPort, "getActiveBinding">,
    private readonly overview: Pick<SessionOverviewCommandHandler, "create">,
    private readonly agentCatalog: AgentCatalog
  ) {}

  async handle(
    message: InboundMessageV1,
    command: SessionContextCommand
  ): Promise<SessionRoutingResult> {
    this.requirePreferences();
    switch (command.type) {
      case "session-fresh":
        return this.startFreshSession(message);
      case "session-history":
        return this.setHistoryLimit(message, command.limit);
      case "session-default":
        return this.resetContext(message);
      case "session-status":
        return this.showStatus(message);
    }
  }

  private async startFreshSession(message: InboundMessageV1): Promise<SessionRoutingResult> {
    const created = await this.overview.create(message, "Fresh session");
    const current = await this.preferences!.getSessionContext?.(preferenceScope(message));
    await this.setForCurrentAndNewThread(message, {
      mode: "persistent",
      ...(current?.historyLimit !== undefined ? { historyLimit: current.historyLimit } : {})
    });
    return {
      ...created,
      command: "session-fresh",
      text: "Fresh session started. This thread will reuse it for subsequent messages."
    };
  }

  private async setHistoryLimit(
    message: InboundMessageV1,
    historyLimit: number
  ): Promise<SessionRoutingResult> {
    const current = await this.preferences!.getSessionContext?.(preferenceScope(message));
    await this.setForCurrentAndNewThread(message, {
      ...(current?.mode ? { mode: current.mode } : {}),
      historyLimit
    });
    return response(
      "session-history",
      `Matrix history set to ${historyLimit} messages per request.`
    );
  }

  private async resetContext(message: InboundMessageV1): Promise<SessionRoutingResult> {
    await this.setForCurrentAndNewThread(message, {});
    return response("session-default", "Session context reset to the selected agent's defaults.");
  }

  private async showStatus(message: InboundMessageV1): Promise<SessionRoutingResult> {
    const scope = preferenceScope(message);
    const preference = (await this.preferences!.getSessionContext?.(scope)) ?? {};
    const agentId = message.agentId ?? this.agentCatalog.defaultAgentId();
    const agent = this.agentCatalog.require(agentId);
    const session = await this.sessions.getActiveBinding({
      ...scope,
      agentId
    });
    return response(
      "session-status",
      [
        "Session context:",
        `Agent: ${agentId}`,
        `Session: ${session?.id ?? "none"}`,
        `Mode: ${preference.mode ?? agent.threadContextPolicy ?? "fresh_session_with_thread_history"}`,
        `Matrix history: ${preference.historyLimit ?? "agent default"}`
      ].join("\n")
    );
  }

  private requirePreferences(): ConversationPreferencePort {
    if (!this.preferences?.getSessionContext || !this.preferences.setSessionContext) {
      throw new Error("Session context preferences are not configured.");
    }
    return this.preferences;
  }

  private async setForCurrentAndNewThread(
    message: InboundMessageV1,
    value: { mode?: "persistent"; historyLimit?: number }
  ): Promise<void> {
    const preferences = this.requirePreferences();
    await preferences.setSessionContext?.({ ...preferenceScope(message), ...value });
    if (!message.threadRootExternalEventId) {
      await preferences.setSessionContext?.({
        ...preferenceScope(message),
        threadRootExternalEventId: message.externalEventId,
        ...value
      });
    }
  }
}

function preferenceScope(message: InboundMessageV1): ConversationPreferenceScope {
  return {
    ...(message.workspaceId ? { workspaceId: message.workspaceId } : {}),
    conversationId: message.conversationId,
    ...(message.threadRootExternalEventId
      ? { threadRootExternalEventId: message.threadRootExternalEventId }
      : {})
  };
}

function response(command: SessionContextCommand["type"], text: string): SessionRoutingResult {
  return { kind: "command-response", command, text };
}
