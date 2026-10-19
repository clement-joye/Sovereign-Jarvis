import type { InboundMessageV1 } from "@second-brain/contracts";
import type { AgentCatalog, CommandDecision, HelpSection } from "@second-brain/domain";

import type { ApprovalCommandHandler } from "../../approvals/commands/approval-command-handler.js";
import { formatRoomCommandHelp } from "../../rooms/room-command-help.js";
import type { ScheduleCommandHandler } from "../../scheduling/commands/schedule-command-handler.js";
import type { SessionLifecycleCommandHandler } from "./session-lifecycle-command-handler.js";
import type { SessionOverviewCommandHandler } from "./session-overview-command-handler.js";
import type { SessionContextCommandHandler } from "./session-context-command-handler.js";
import type { SessionRoutingResult } from "../routing/session-routing-result.js";
import type { VoicePreferenceCommandHandler } from "./voice-preference-command-handler.js";

export interface SessionCommandDispatcherOptions {
  overview: SessionOverviewCommandHandler;
  schedules: ScheduleCommandHandler;
  lifecycle: SessionLifecycleCommandHandler;
  context: SessionContextCommandHandler;
  voice: VoicePreferenceCommandHandler;
  approvals?: Pick<ApprovalCommandHandler, "handle">;
  agentCatalog: AgentCatalog;
}

/** Dispatches parsed commands to the command handler that owns their behavior. */
export class SessionCommandDispatcher {
  constructor(private readonly options: SessionCommandDispatcherOptions) {}

  dispatch(message: InboundMessageV1, command: CommandDecision): Promise<SessionRoutingResult> {
    if (command.type === "invalid" || command.type === "help") {
      return Promise.resolve(this.helpResponse(command));
    }
    if (isOverviewCommand(command)) return this.dispatchOverview(message, command);
    if (isSessionContextCommand(command)) return this.options.context.handle(message, command);
    if (isScheduleCommand(command)) return this.dispatchSchedule(message, command);
    if (isLifecycleCommand(command)) return this.dispatchLifecycle(message, command);
    if (isApprovalCommand(command)) return this.dispatchApproval(message, command);
    if (command.type === "voice") return this.dispatchVoice(message, command.enabled);
    throw new Error("not-command must be handled before command dispatch.");
  }

  private helpResponse(
    command: Extract<CommandDecision, { type: "invalid" | "help" }>
  ): SessionRoutingResult {
    if (command.type === "help") {
      return { kind: "command-response", command: "help", text: this.help(command.section) };
    }
    return {
      kind: "command-response",
      command: "invalid",
      text: `**Command not recognised**\n\n${command.message}\n\n${this.help()}`
    };
  }

  private dispatchOverview(
    message: InboundMessageV1,
    command: Extract<CommandDecision, { type: "new" | "sessions" }>
  ): Promise<SessionRoutingResult> {
    return command.type === "new"
      ? this.options.overview.create(message, command.label)
      : this.options.overview.list(message);
  }

  private dispatchSchedule(
    message: InboundMessageV1,
    command: Extract<
      CommandDecision,
      { type: "schedules" | "schedule" | "schedule-run" | "schedule-delete" }
    >
  ): Promise<SessionRoutingResult> {
    if (command.type === "schedules") return this.options.schedules.list(message.workspaceId);
    if (command.type === "schedule") {
      return this.options.schedules.describe(command.selector, message.workspaceId);
    }
    if (command.type === "schedule-run") {
      return this.options.schedules.run(command.selector, message.workspaceId);
    }
    return this.options.schedules.delete(command.selectors, message.workspaceId);
  }

  private dispatchLifecycle(
    message: InboundMessageV1,
    command: Extract<CommandDecision, { type: "close" | "close-all" | "cancel" }>
  ): Promise<SessionRoutingResult> {
    if (command.type === "close-all") return this.options.lifecycle.closeAll(message);
    if (command.type === "cancel") return this.options.lifecycle.cancel(message);
    return command.selectors
      ? this.options.lifecycle.closeSelected(message, command.selectors)
      : this.options.lifecycle.closeCurrent(message);
  }

  private async dispatchApproval(
    message: InboundMessageV1,
    command: Extract<
      CommandDecision,
      { type: "approve" | "reject" | "approve-reply" | "reject-reply" }
    >
  ): Promise<SessionRoutingResult> {
    return {
      kind: "command-response",
      command: command.type,
      ...(!this.options.approvals ? { presentation: "error" as const } : {}),
      text: this.options.approvals
        ? await this.options.approvals.handle(message, command)
        : "**Approvals unavailable**\n\nThe durable approval service is not configured."
    };
  }

  private async dispatchVoice(
    message: InboundMessageV1,
    enabled: boolean | undefined
  ): Promise<SessionRoutingResult> {
    const result = await this.options.voice.handle(message, enabled);
    return { kind: "command-response", command: "voice", text: result.text };
  }

  private help(section?: HelpSection): string {
    return formatRoomCommandHelp(this.options.agentCatalog.ids(), section);
  }
}

function isSessionContextCommand(
  command: CommandDecision
): command is Extract<
  CommandDecision,
  { type: "session-fresh" | "session-history" | "session-default" | "session-status" }
> {
  return ["session-fresh", "session-history", "session-default", "session-status"].includes(
    command.type
  );
}

function isOverviewCommand(
  command: CommandDecision
): command is Extract<CommandDecision, { type: "new" | "sessions" }> {
  return command.type === "new" || command.type === "sessions";
}

function isScheduleCommand(
  command: CommandDecision
): command is Extract<
  CommandDecision,
  { type: "schedules" | "schedule" | "schedule-run" | "schedule-delete" }
> {
  return ["schedules", "schedule", "schedule-run", "schedule-delete"].includes(command.type);
}

function isLifecycleCommand(
  command: CommandDecision
): command is Extract<CommandDecision, { type: "close" | "close-all" | "cancel" }> {
  return ["close", "close-all", "cancel"].includes(command.type);
}

function isApprovalCommand(
  command: CommandDecision
): command is Extract<
  CommandDecision,
  { type: "approve" | "reject" | "approve-reply" | "reject-reply" }
> {
  return ["approve", "reject", "approve-reply", "reject-reply"].includes(command.type);
}
