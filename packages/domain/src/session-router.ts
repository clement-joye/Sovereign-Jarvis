import type { SessionResolutionV1 } from "@second-brain/contracts";
import type { ClockPort } from "./clock.js";
import type { IdGeneratorPort } from "./id-generator.js";

export type SessionStatus = "active" | "idle" | "closed" | "expired" | "purged";

export interface SessionRecord {
  id: string;
  workspaceId?: string;
  label?: string;
  status: SessionStatus;
  createdAt: Date;
  lastActiveAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  piSessionKey: string;
  sourceType: "default-room" | "thread" | "scheduled";
  sourceConversationId?: string;
  sourceThreadRootId?: string;
  sourceScheduleId?: string;
}

export interface ResolveInboundContext {
  conversationId: string;
  threadRootExternalEventId?: string;
  activeSession?: SessionRecord;
  idleContinuationMs: number;
  retentionMs: number;
}

export interface SessionDecision {
  resolution: SessionResolutionV1;
  command: "create-and-bind" | "resume" | "replace-expired";
}

export function resolveInboundSession(
  context: ResolveInboundContext,
  clock: ClockPort,
  ids: IdGeneratorPort
): SessionDecision {
  const now = clock.now();
  const sourceMode = context.threadRootExternalEventId ? "thread" : "default-room";
  const active = context.activeSession;

  if (active && canResume(active, now, context.idleContinuationMs)) {
    return {
      command: "resume",
      resolution: {
        schemaVersion: 1,
        sessionId: active.id,
        mode: sourceMode,
        created: false,
        expiresAt: active.absoluteExpiresAt.toISOString(),
        sourceConversationId: context.conversationId,
        sourceThreadRootId: context.threadRootExternalEventId
      }
    };
  }

  const sessionId = ids.nextId("session");
  const absoluteExpiresAt = new Date(now.getTime() + context.retentionMs);

  return {
    command: active ? "replace-expired" : "create-and-bind",
    resolution: {
      schemaVersion: 1,
      sessionId,
      mode: sourceMode,
      created: true,
      expiresAt: absoluteExpiresAt.toISOString(),
      sourceConversationId: context.conversationId,
      sourceThreadRootId: context.threadRootExternalEventId
    }
  };
}

function canResume(session: SessionRecord, now: Date, idleContinuationMs: number): boolean {
  if (session.status !== "active" && session.status !== "idle") {
    return false;
  }

  if (session.absoluteExpiresAt.getTime() <= now.getTime()) {
    return false;
  }

  return now.getTime() - session.lastActiveAt.getTime() <= idleContinuationMs;
}

export type ExpiryDecision =
  | { expired: false }
  | { expired: true; reason: "idle" | "absolute" | "closed" };

export function evaluateSessionExpiry(
  session: SessionRecord,
  now: Date,
  idleContinuationMs: number
): ExpiryDecision {
  if (session.status === "closed" || session.status === "expired" || session.status === "purged") {
    return { expired: true, reason: "closed" };
  }
  if (session.absoluteExpiresAt.getTime() <= now.getTime()) {
    return { expired: true, reason: "absolute" };
  }
  if (now.getTime() - session.lastActiveAt.getTime() > idleContinuationMs) {
    return { expired: true, reason: "idle" };
  }
  return { expired: false };
}

export const HELP_SECTIONS = [
  "sessions",
  "approvals",
  "schedules",
  "preferences",
  "agents",
  "plugins",
  "workspace"
] as const;

export type HelpSection = (typeof HELP_SECTIONS)[number];

export type CommandDecision =
  | { type: "help"; section?: HelpSection }
  | { type: "new"; label?: string }
  | { type: "session-fresh" }
  | { type: "session-history"; limit: number }
  | { type: "session-default" }
  | { type: "session-status" }
  | { type: "sessions" }
  | { type: "schedules" }
  | { type: "schedule"; selector?: string }
  | { type: "schedule-run"; selector?: string }
  | { type: "schedule-delete"; selectors?: string[] }
  | { type: "close"; selectors?: string[] }
  | { type: "close-all" }
  | { type: "cancel" }
  | { type: "approve"; proposalId: string }
  | { type: "reject"; proposalId: string }
  | { type: "approve-reply" }
  | { type: "reject-reply" }
  | { type: "voice"; enabled?: boolean }
  | { type: "not-command" }
  | { type: "invalid"; message: string };

export function parseSessionCommand(text: string): CommandDecision {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return { type: "not-command" };

  const [commandToken, ...rest] = trimmed.split(/\s+/);
  const command = commandToken ?? "";
  const argument = rest.join(" ").trim();
  const parser = commandParsers[command];
  return parser ? parser({ command, rest, argument }) : unsupportedCommand(command);
}

interface CommandParseInput {
  command: string;
  rest: string[];
  argument: string;
}

type CommandParser = (input: CommandParseInput) => CommandDecision;

const commandParsers: Record<string, CommandParser> = {
  "/help": parseHelpCommand,
  "/new": ({ argument }) => (argument ? { type: "new", label: argument } : { type: "new" }),
  "/session": parseSessionContextCommand,
  "/sessions": parseSessionsCommand,
  "/schedules": parseSchedulesCommand,
  "/schedule": parseScheduleCommand,
  "/close": ({ rest }) => ({ type: "close", ...(rest.length > 0 ? { selectors: rest } : {}) }),
  "/cancel": ({ command, argument }) => (argument ? invalidNoArgs(command) : { type: "cancel" }),
  "/approve": ({ command, rest }) => parseApprovalCommand(command, rest),
  "/reject": ({ command, rest }) => parseApprovalCommand(command, rest),
  "/yes": ({ command, argument }) =>
    argument ? invalidNoArgs(command) : { type: "approve-reply" },
  "/no": ({ command, argument }) => (argument ? invalidNoArgs(command) : { type: "reject-reply" }),
  "/voice": parseVoiceCommand
};

function parseSessionContextCommand({ rest }: CommandParseInput): CommandDecision {
  if (rest.length === 1 && rest[0] === "fresh") return { type: "session-fresh" };
  if (rest.length === 1 && rest[0] === "default") return { type: "session-default" };
  if (rest.length === 1 && rest[0] === "status") return { type: "session-status" };
  if (rest.length === 2 && rest[0] === "history") {
    const limit = Number(rest[1]);
    if (Number.isInteger(limit) && limit >= 0 && limit <= 100) {
      return { type: "session-history", limit };
    }
  }
  return {
    type: "invalid",
    message: "/session accepts `fresh`, `history <0-100>`, `default`, or `status`."
  };
}

function parseHelpCommand({ rest }: CommandParseInput): CommandDecision {
  if (rest.length === 0) return { type: "help" };
  const section = rest[0];
  if (rest.length === 1 && isHelpSection(section)) return { type: "help", section };
  return {
    type: "invalid",
    message: `/help accepts one of: ${HELP_SECTIONS.join(", ")}.`
  };
}

function isHelpSection(value: string | undefined): value is HelpSection {
  return HELP_SECTIONS.some((section) => section === value);
}

// Proposal IDs are opaque to the command surface. Restricting them to a
// bounded URL/path-safe alphabet keeps replies and future transport adapters
// unambiguous while still accepting IDs generated by the application.
const SAFE_PROPOSAL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function parseApprovalCommand(command: string, rest: string[]): CommandDecision {
  if (rest.length !== 1 || !rest[0]) {
    return {
      type: "invalid",
      message: `${command} requires exactly one proposal ID: ${command} <proposal-id>.`
    };
  }
  const proposalId = rest[0];
  if (!SAFE_PROPOSAL_ID.test(proposalId)) {
    return {
      type: "invalid",
      message: `${command} received an unsafe proposal ID. Use only letters, numbers, underscore, or hyphen (up to 128 characters).`
    };
  }
  return { type: command === "/approve" ? "approve" : "reject", proposalId };
}

function parseSessionsCommand({ argument }: CommandParseInput): CommandDecision {
  if (!argument) return { type: "sessions" };
  return argument === "close"
    ? { type: "close-all" }
    : { type: "invalid", message: "/sessions accepts only `close`." };
}

function parseSchedulesCommand({ argument }: CommandParseInput): CommandDecision {
  return argument
    ? { type: "invalid", message: "/schedules does not accept arguments." }
    : { type: "schedules" };
}

function parseScheduleCommand({ argument, rest }: CommandParseInput): CommandDecision {
  if (rest.length === 2 && rest[0] && rest[1] === "run")
    return { type: "schedule-run", selector: rest[0] };
  if (rest[0] !== "delete") {
    return { type: "schedule", ...(argument ? { selector: argument } : {}) };
  }
  const selectors = rest.slice(1);
  return { type: "schedule-delete", ...(selectors.length > 0 ? { selectors } : {}) };
}

function parseVoiceCommand({ argument }: CommandParseInput): CommandDecision {
  if (!argument) return { type: "voice" };
  if (argument === "on") return { type: "voice", enabled: true };
  if (argument === "off") return { type: "voice", enabled: false };
  return { type: "invalid", message: "/voice accepts only `on` or `off`." };
}

function unsupportedCommand(command: string): CommandDecision {
  return { type: "invalid", message: `Unsupported command: ${command}` };
}

function invalidNoArgs(command: string): CommandDecision {
  return { type: "invalid", message: `${command} does not accept arguments.` };
}
