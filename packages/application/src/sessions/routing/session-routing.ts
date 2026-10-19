import type { InboundMessageV1 } from "@second-brain/contracts";
import {
  parseSessionCommand,
  type AgentCatalog,
  type ClockPort,
  type IdGeneratorPort
} from "@second-brain/domain";

import type { ScheduleRepositoryPort, SessionRepositoryPort } from "../../ports.js";
import type { ConversationPreferencePort } from "../../ports.js";
import { VoicePreferenceCommandHandler } from "../commands/voice-preference-command-handler.js";
import { ScheduleCommandHandler } from "../../scheduling/commands/schedule-command-handler.js";
import { SessionLifecycleCommandHandler } from "../commands/session-lifecycle-command-handler.js";
import { SessionOverviewCommandHandler } from "../commands/session-overview-command-handler.js";
import { ConversationSessionHandler } from "../presentation/conversation-session-handler.js";
import type { SessionRoutingResult } from "./session-routing-result.js";
import type { ApprovalCommandHandler } from "../../approvals/commands/approval-command-handler.js";
import { SessionCommandDispatcher } from "../commands/session-command-dispatcher.js";
import { SessionRecordFactory } from "../presentation/session-record-factory.js";
import { SessionContextCommandHandler } from "../commands/session-context-command-handler.js";

// Maximum length, in characters, of a session title outside of threads.
const IMPLICIT_NEW_MAX_LENGTH = 120;

export interface SessionRoutingConfig {
  idleContinuationMs: number;
  retentionMs: number;
  scheduleDisplayTimezone: string;
}

export type { SessionRoutingResult } from "./session-routing-result.js";

export interface SessionRoutingServiceOptions {
  sessions: SessionRepositoryPort;
  preferences?: ConversationPreferencePort;
  schedules?: ScheduleRepositoryPort;
  clock: ClockPort;
  ids: IdGeneratorPort;
  config: SessionRoutingConfig;
  // Optional pre-constructed handlers to allow external wiring extraction.
  voicePreferences?: VoicePreferenceCommandHandler;
  scheduleCommands?: ScheduleCommandHandler;
  lifecycleCommands?: SessionLifecycleCommandHandler;
  overviewCommands?: SessionOverviewCommandHandler;
  conversations?: ConversationSessionHandler;
  approvalCommands?: Pick<ApprovalCommandHandler, "handle">;
  agentCatalog: AgentCatalog;
}

export class SessionRoutingService {
  private readonly sessions: SessionRepositoryPort;
  private readonly overviewCommands: SessionOverviewCommandHandler;
  private readonly conversations: ConversationSessionHandler;
  private readonly commands: SessionCommandDispatcher;

  constructor(options: SessionRoutingServiceOptions) {
    this.sessions = options.sessions;
    // Use injected handlers when provided to allow wiring extraction; otherwise
    // keep current internal construction for backward compatibility.
    const voicePreferences =
      options.voicePreferences ?? new VoicePreferenceCommandHandler(options.preferences);

    const scheduleCommands =
      options.scheduleCommands ??
      new ScheduleCommandHandler(
        options.schedules,
        options.clock,
        options.config.scheduleDisplayTimezone
      );

    const lifecycleCommands =
      options.lifecycleCommands ??
      new SessionLifecycleCommandHandler(options.sessions, options.clock, (message, sessionId) =>
        this.bindReplyThread(message, sessionId)
      );

    this.overviewCommands =
      options.overviewCommands ??
      new SessionOverviewCommandHandler(
        options.sessions,
        new SessionRecordFactory(options.clock, options.ids, options.config),
        () => options.clock.now(),
        (message, sessionId) => this.bindReplyThread(message, sessionId)
      );

    this.conversations =
      options.conversations ??
      new ConversationSessionHandler(options.sessions, options.clock, options.ids, options.config);
    this.commands = new SessionCommandDispatcher({
      overview: this.overviewCommands,
      schedules: scheduleCommands,
      lifecycle: lifecycleCommands,
      context: new SessionContextCommandHandler(
        options.preferences,
        options.sessions,
        this.overviewCommands,
        options.agentCatalog
      ),
      voice: voicePreferences,
      ...(options.approvalCommands ? { approvals: options.approvalCommands } : {}),
      agentCatalog: options.agentCatalog
    });
  }

  async routeInbound(message: InboundMessageV1): Promise<SessionRoutingResult> {
    const command = message.text
      ? parseSessionCommand(message.text)
      : { type: "not-command" as const };
    if (command.type !== "not-command") {
      return this.commands.dispatch(message, command);
    }

    // Top-level (non-thread) room messages that don't parse as a command
    // are folded into the implicit `/new` flow: the message text becomes
    // the new session's label, and we run the same handler that
    // `/new <label>` would. This guarantees every room-level message
    // lands in its own Pi session and the user gets a searchable name
    // for it. Messages in threads continue the active thread session as
    // before so replies don't fragment the conversation.
    if (message.text && !message.threadRootExternalEventId) {
      const trimmed = message.text.trim();
      if (trimmed.length === 0) {
        // Empty / whitespace-only — fall through to send-to-pi so the
        // user can still see a reply to a no-op message.
      } else if (trimmed.length < IMPLICIT_NEW_MAX_LENGTH) {
        return this.overviewCommands.create(message, trimmed);
      } else {
        return {
          kind: "command-response",
          command: "invalid",
          text: [
            "**Session title too long**",
            "",
            `Messages in the room become the new session's title, and the title must be under ${IMPLICIT_NEW_MAX_LENGTH} characters.`,
            "Send a shorter message, or use `/new [name]` with an explicit, longer label."
          ].join("\n")
        };
      }
    }

    return { kind: "send-to-pi", resolution: await this.conversations.resolve(message) };
  }

  private async bindReplyThread(message: InboundMessageV1, sessionId: string): Promise<void> {
    if (message.threadRootExternalEventId) return;
    await this.sessions.activateBinding({
      sessionId,
      ...(message.workspaceId ? { workspaceId: message.workspaceId } : {}),
      ...(message.agentId ? { agentId: message.agentId } : {}),
      conversationId: message.conversationId,
      threadRootExternalEventId: message.externalEventId
    });
  }
}
