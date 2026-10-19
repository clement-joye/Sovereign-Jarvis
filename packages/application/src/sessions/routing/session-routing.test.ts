import { describe, expect, it, vi } from "vitest";

import type { InboundMessageV1, ScheduledJobV1 } from "@second-brain/contracts";
import {
  INITIAL_AGENT_CATALOG,
  type ClockPort,
  type IdGeneratorPort,
  type SessionRecord
} from "@second-brain/domain";

import { SessionRoutingService } from "./session-routing.js";
import type { ApprovalCommand } from "../../approvals/commands/approval-command-handler.js";
import type {
  ConversationPreferencePort,
  ScheduleRepositoryPort,
  SessionRepositoryPort
} from "../../ports.js";

describe("SessionRoutingService", () => {
  describe("active session routing", () => {
    it("creates a fresh room session per implicit /new from each short top-level message", async () => {
      const sessions = new InMemorySessionRepository();
      const service = createService(sessions);

      const first = await service.routeInbound(message({ text: "hello" }));
      const second = await service.routeInbound(message({ text: "again" }));

      expect(first).toMatchObject({
        kind: "command-response",
        command: "new",
        text: "New session: hello"
      });
      expect(second).toMatchObject({
        kind: "command-response",
        command: "new",
        text: "New session: again"
      });
      expect(sessions.snapshot()).toHaveLength(2);
      expect(sessions.snapshot().map((s) => s.label)).toEqual(["hello", "again"]);
    });

    it("keeps implicit room bindings isolated by workspace", async () => {
      const sessions = new InMemorySessionRepository();
      const service = createService(sessions);

      await service.routeInbound(message({ text: "one", workspaceId: "workspace-one" }));
      await service.routeInbound(message({ text: "two", workspaceId: "workspace-two" }));

      await expect(
        sessions.getActiveBinding({ workspaceId: "workspace-one", conversationId: "!room:example" })
      ).resolves.toMatchObject({ workspaceId: "workspace-one" });
      await expect(
        sessions.getActiveBinding({ workspaceId: "workspace-two", conversationId: "!room:example" })
      ).resolves.toMatchObject({ workspaceId: "workspace-two" });
    });

    it("rejects top-level room messages that are 120 characters or longer", async () => {
      const sessions = new InMemorySessionRepository();
      const service = createService(sessions);

      const tooLong = "a".repeat(120);
      const reply = await service.routeInbound(message({ text: tooLong }));

      expect(reply).toMatchObject({
        kind: "command-response",
        command: "invalid"
      });
      expect((reply as { text: string }).text).toContain("**Session title too long**");
      expect((reply as { text: string }).text).toContain("/new [name]");
      expect(sessions.snapshot()).toHaveLength(0);
    });

    it("keeps two Matrix thread sessions independent from each other", async () => {
      const sessions = new InMemorySessionRepository();
      const service = createService(sessions);

      const threadA = await service.routeInbound(
        message({ text: "a", threadRootExternalEventId: "$a" })
      );
      const threadB = await service.routeInbound(
        message({ text: "b", threadRootExternalEventId: "$b" })
      );
      const threadAAgain = await service.routeInbound(
        message({ text: "a again", threadRootExternalEventId: "$a" })
      );

      expect(threadA).toMatchObject({ resolution: { sessionId: "session-1", mode: "thread" } });
      expect(threadB).toMatchObject({ resolution: { sessionId: "session-2", mode: "thread" } });
      expect(threadAAgain).toMatchObject({
        resolution: { sessionId: "session-1", mode: "thread", created: false }
      });
    });
  });

  describe("session lifecycle and commands", () => {
    it("shows a compact section index for /help", async () => {
      const service = createService(new InMemorySessionRepository());

      const result = await service.routeInbound(message({ text: "/help" }));
      expect(result).toMatchObject({
        kind: "command-response",
        command: "help",
        text: expect.stringContaining("**Help**")
      });
      if (result.kind !== "command-response") throw new Error("Expected a help response.");
      expect(result.text).toContain("/help sessions");
      expect(result.text).toContain("/help plugins");
      expect(result.text).not.toContain("/schedule delete <number ...>");
      expect(result.text).not.toContain("/workspace status");
    });

    it("shows detailed commands only for the requested help section", async () => {
      const service = createService(new InMemorySessionRepository());

      await expect(
        service.routeInbound(message({ text: "/help schedules" }))
      ).resolves.toMatchObject({
        text: expect.stringContaining("/schedule delete <number ...>")
      });
      const plugins = await service.routeInbound(message({ text: "/help plugins" }));
      if (plugins.kind !== "command-response") throw new Error("Expected plugin help.");
      expect(plugins.text).toContain("/plugin enable <plugin-id>");
      expect(plugins.text).toContain("never paste a token or secret");
      expect(plugins.text).not.toContain("/workspace status");
    });

    it("dispatches approval commands to the injected approval handler", async () => {
      const handle = vi.fn(async (_message: InboundMessageV1, command: ApprovalCommand) =>
        command.type === "approve" ? "approved response" : "rejected response"
      );
      const service = createService(
        new InMemorySessionRepository(),
        undefined,
        undefined,
        undefined,
        "UTC",
        {
          handle
        }
      );

      await expect(
        service.routeInbound(message({ text: "/approve proposal-1" }))
      ).resolves.toMatchObject({
        kind: "command-response",
        command: "approve",
        text: "approved response"
      });
      await expect(
        service.routeInbound(message({ text: "/reject proposal-2" }))
      ).resolves.toMatchObject({
        kind: "command-response",
        command: "reject",
        text: "rejected response"
      });
      expect(handle).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ text: "/approve proposal-1" }),
        { type: "approve", proposalId: "proposal-1" }
      );
      expect(handle).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ text: "/reject proposal-2" }),
        { type: "reject", proposalId: "proposal-2" }
      );
    });

    it("fails closed when approval commands are unavailable", async () => {
      const service = createService(new InMemorySessionRepository());

      await expect(
        service.routeInbound(message({ text: "/approve proposal-1" }))
      ).resolves.toMatchObject({
        kind: "command-response",
        command: "approve",
        text: "**Approvals unavailable**\n\nThe durable approval service is not configured."
      });
      await expect(
        service.routeInbound(message({ text: "/reject proposal-1" }))
      ).resolves.toMatchObject({
        kind: "command-response",
        command: "reject",
        text: "**Approvals unavailable**\n\nThe durable approval service is not configured."
      });
    });

    it("handles /new, /sessions, /close, and /cancel deterministically", async () => {
      const sessions = new InMemorySessionRepository();
      const service = createService(sessions);

      await service.routeInbound(message({ text: "hello" }));
      const newSession = await service.routeInbound(message({ text: "/new notes" }));
      expect(newSession).toMatchObject({
        kind: "command-response",
        command: "new",
        sessionId: "session-2"
      });
      expect(newSession).toMatchObject({ text: expect.not.stringContaining("ID:") });
      await expect(service.routeInbound(message({ text: "/sessions" }))).resolves.toMatchObject({
        command: "sessions"
      });
      await expect(service.routeInbound(message({ text: "/cancel" }))).resolves.toMatchObject({
        command: "cancel",
        text: "Cancellation requested."
      });
      await expect(service.routeInbound(message({ text: "/close" }))).resolves.toMatchObject({
        command: "close",
        sessionId: "session-2"
      });
      await expect(service.routeInbound(message({ text: "after close" }))).resolves.toMatchObject({
        kind: "command-response",
        command: "new",
        sessionId: "session-3"
      });
    });

    it("rotates session context and restores agent defaults", async () => {
      const sessions = new InMemorySessionRepository();
      const preferences = new InMemoryConversationPreferences();
      const service = createService(sessions, undefined, preferences);
      const thread = "$root";

      await service.routeInbound(message({ text: "before", threadRootExternalEventId: thread }));
      const fresh = await service.routeInbound(
        message({ text: "/session fresh", threadRootExternalEventId: thread })
      );
      expect(fresh).toMatchObject({ command: "session-fresh", sessionId: "session-2" });
      await service.routeInbound(
        message({ text: "/session history 7", threadRootExternalEventId: thread })
      );
      await expect(
        service.routeInbound(
          message({ text: "/session status", threadRootExternalEventId: thread })
        )
      ).resolves.toMatchObject({
        text: expect.stringMatching(
          /Session: session-2[\s\S]*Mode: persistent[\s\S]*Matrix history: 7/u
        )
      });

      await service.routeInbound(
        message({ text: "/session default", threadRootExternalEventId: thread })
      );
      await expect(
        preferences.getSessionContext?.({
          conversationId: "!room:example",
          threadRootExternalEventId: thread
        })
      ).resolves.toEqual({});
    });

    it("creates a separate session for every implicit /new and keeps the previous /new untouched", async () => {
      const sessions = new InMemorySessionRepository();
      const service = createService(sessions);

      await service.routeInbound(message({ text: "/new" }));
      await service.routeInbound(message({ text: "Plan a weekend hiking trip with my brother" }));

      const snapshot = sessions.snapshot();
      expect(snapshot).toHaveLength(2);
      expect(snapshot[0]).toMatchObject({ id: "session-1" });
      expect(snapshot[0]?.label).toBeUndefined();
      expect(snapshot[1]).toMatchObject({
        id: "session-2",
        label: "Plan a weekend hiking trip with my brother"
      });
    });

    it("continues a top-level /new session when the next message arrives in its reply thread", async () => {
      const sessions = new InMemorySessionRepository();
      const service = createService(sessions);

      await service.routeInbound(message({ text: "/new notes" }));

      await expect(
        service.routeInbound(
          message({ text: "continue notes", threadRootExternalEventId: "$/new notes" })
        )
      ).resolves.toMatchObject({
        kind: "send-to-pi",
        resolution: { sessionId: "session-1", mode: "thread", created: false }
      });
    });

    it("formats session command replies as readable Matrix messages", async () => {
      const sessions = new InMemorySessionRepository();
      const service = createService(sessions);

      await service.routeInbound(
        message({ text: "Plan a trip to Stockholm with museums and coffee" })
      );
      await service.routeInbound(message({ text: "/new Project notes" }));

      await expect(service.routeInbound(message({ text: "/sessions" }))).resolves.toMatchObject({
        text: [
          "Recent sessions (2):",
          "1. Plan a trip to Stockholm with museums and coffee · Active · Last activity 2026-07-17 15:00:00 UTC",
          "2. Project notes · Active · Last activity 2026-07-17 15:00:00 UTC"
        ].join("\n")
      });
    });

    it("omits closed sessions from /sessions and its numeric selection", async () => {
      const sessions = new InMemorySessionRepository();
      const service = createService(sessions);
      await service.routeInbound(message({ text: "first active session" }));
      await service.routeInbound(message({ text: "/new second active session" }));
      await service.routeInbound(message({ text: "/close" }));

      await expect(service.routeInbound(message({ text: "/sessions" }))).resolves.toMatchObject({
        text: [
          "Recent sessions (1):",
          "1. first active session · Active · Last activity 2026-07-17 15:00:00 UTC"
        ].join("\n")
      });
    });

    it("closes an active session selected by its /sessions number", async () => {
      const sessions = new InMemorySessionRepository();
      const service = createService(sessions);
      await service.routeInbound(message({ text: "first session" }));
      await service.routeInbound(message({ text: "/new second session" }));

      await expect(service.routeInbound(message({ text: "/close 1" }))).resolves.toMatchObject({
        command: "close",
        sessionId: "session-1",
        text: "Session closed."
      });
      expect(sessions.snapshot().find((session) => session.id === "session-1")).toMatchObject({
        status: "closed"
      });
      await expect(service.routeInbound(message({ text: "/sessions" }))).resolves.toMatchObject({
        text: expect.stringContaining("1. second session · Active")
      });
    });

    it("closes several sessions from one stable /sessions list", async () => {
      const sessions = new InMemorySessionRepository();
      const service = createService(sessions);
      await service.routeInbound(message({ text: "first session" }));
      await service.routeInbound(message({ text: "/new second session" }));
      await service.routeInbound(message({ text: "/new third session" }));

      await expect(service.routeInbound(message({ text: "/close 1 3" }))).resolves.toMatchObject({
        command: "close",
        text: expect.stringContaining("Closed 2 sessions")
      });
      expect(
        sessions
          .snapshot()
          .filter((session) => session.status === "closed")
          .map((session) => session.id)
      ).toEqual(["session-1", "session-3"]);
    });

    it("creates a fresh session when the active binding is idle-expired under fake time", async () => {
      const sessions = new InMemorySessionRepository();
      const clock = new MutableClock("2026-07-17T15:00:00.000Z");
      const service = createService(sessions, clock);

      await service.routeInbound(message({ text: "hello" }));
      clock.set("2026-07-19T15:00:00.000Z");

      await expect(service.routeInbound(message({ text: "later" }))).resolves.toMatchObject({
        kind: "command-response",
        command: "new",
        sessionId: "session-2"
      });
    });

    it("persists /voice changes per conversation and thread", async () => {
      const preferences = new InMemoryConversationPreferences();
      const service = createService(new InMemorySessionRepository(), undefined, preferences);

      await expect(service.routeInbound(message({ text: "/voice" }))).resolves.toMatchObject({
        text: expect.stringContaining("Voice replies: off.")
      });
      await expect(service.routeInbound(message({ text: "/voice on" }))).resolves.toMatchObject({
        text: expect.stringContaining("Voice replies: on.")
      });
      await expect(service.routeInbound(message({ text: "/voice" }))).resolves.toMatchObject({
        text: expect.stringContaining("Voice replies: on.")
      });
      await expect(
        service.routeInbound(message({ text: "/voice", threadRootExternalEventId: "$thread" }))
      ).resolves.toMatchObject({ text: expect.stringContaining("Voice replies: off.") });
      await expect(
        service.routeInbound(message({ text: "/voice", threadRootExternalEventId: "$/voice on" }))
      ).resolves.toMatchObject({ text: expect.stringContaining("Voice replies: on.") });
    });

    it("closes every active session with /sessions close", async () => {
      const sessions = new InMemorySessionRepository();
      const service = createService(sessions);
      await service.routeInbound(message({ text: "room" }));
      await service.routeInbound(message({ text: "thread", threadRootExternalEventId: "$thread" }));

      await expect(
        service.routeInbound(message({ text: "/sessions close" }))
      ).resolves.toMatchObject({
        command: "close-all",
        text: "Closed 2 active sessions."
      });
      expect(sessions.snapshot().map((session) => session.status)).toEqual(["closed", "closed"]);
    });
  });

  describe("schedule commands", () => {
    it("lists scheduled jobs and shows details by displayed number", async () => {
      const schedules = {
        async list() {
          return [scheduledJob()];
        },
        async hardDeleteDisabledOlderThan() {
          return 0;
        }
      } as unknown as ScheduleRepositoryPort;
      const service = createService(
        new InMemorySessionRepository(),
        undefined,
        undefined,
        schedules
      );

      await expect(service.routeInbound(message({ text: "/schedules" }))).resolves.toMatchObject({
        text: [
          "Scheduled jobs",
          "",
          "Active (1)",
          "",
          "1. Morning review · Next run: 2026-07-18 07:00:00 UTC",
          ""
        ].join("\n")
      });
      await expect(service.routeInbound(message({ text: "/schedule 1" }))).resolves.toMatchObject({
        text: [
          "Morning review",
          "",
          "Status: Active",
          "",
          "When",
          "Schedule: Cron `0 9 * * 1-5` (Europe/Stockholm)",
          "Next run: 2026-07-18 07:00:00 UTC",
          "Last run: Never",
          "",
          "Behavior",
          "Session: Fresh",
          "Notifications: Always",
          "Instruction: Summarize priorities."
        ].join("\n")
      });
    });

    it("only lists schedules owned by the inbound room workspace", async () => {
      const schedules = {
        async list() {
          return [
            { ...scheduledJob(), workspaceId: "workspace-current" },
            {
              ...scheduledJob(),
              id: "schedule-other",
              name: "Other room schedule",
              workspaceId: "workspace-other"
            }
          ];
        },
        async hardDeleteDisabledOlderThan() {
          return 0;
        }
      } as unknown as ScheduleRepositoryPort;
      const service = createService(
        new InMemorySessionRepository(),
        undefined,
        undefined,
        schedules
      );

      await expect(
        service.routeInbound(message({ text: "/schedules", workspaceId: "workspace-current" }))
      ).resolves.toMatchObject({
        text: expect.stringContaining("Morning review")
      });
      await expect(
        service.routeInbound(message({ text: "/schedules", workspaceId: "workspace-current" }))
      ).resolves.toMatchObject({
        text: expect.not.stringContaining("Other room schedule")
      });
    });

    it("displays schedule instants in the configured timezone", async () => {
      const schedules = {
        async list() {
          return [scheduledJob()];
        },
        async hardDeleteDisabledOlderThan() {
          return 0;
        }
      } as unknown as ScheduleRepositoryPort;
      const service = createService(
        new InMemorySessionRepository(),
        undefined,
        undefined,
        schedules,
        "Europe/Stockholm"
      );

      await expect(service.routeInbound(message({ text: "/schedules" }))).resolves.toMatchObject({
        text: expect.stringContaining("2026-07-18 09:00:00 Europe/Stockholm")
      });
    });

    it("deletes a scheduled job by its /schedules number", async () => {
      const deleted: Array<{ id: string; expectedVersion?: number }> = [];
      const schedules = {
        async list() {
          return [scheduledJob()];
        },
        async delete(input: { id: string; expectedVersion?: number }) {
          deleted.push(input);
          return scheduledJob();
        },
        async hardDeleteDisabledOlderThan() {
          return 0;
        }
      } as unknown as ScheduleRepositoryPort;
      const service = createService(
        new InMemorySessionRepository(),
        undefined,
        undefined,
        schedules
      );

      await expect(
        service.routeInbound(message({ text: "/schedule delete 1" }))
      ).resolves.toMatchObject({
        command: "schedule-delete",
        text: "Deleted Morning review. It will not run again."
      });
      expect(deleted).toMatchObject([{ id: "schedule-1", expectedVersion: 1 }]);
    });

    it("deletes several scheduled jobs by their /schedules numbers", async () => {
      const deleted: string[] = [];
      const schedules = {
        async list() {
          return [
            scheduledJob(),
            {
              ...scheduledJob(),
              id: "schedule-2",
              name: "Evening review",
              nextRunAt: "2026-07-18T19:00:00.000Z"
            }
          ];
        },
        async delete(input: { id: string }) {
          deleted.push(input.id);
          return { ...scheduledJob(), id: input.id };
        },
        async hardDeleteDisabledOlderThan() {
          return 0;
        }
      } as unknown as ScheduleRepositoryPort;
      const service = createService(
        new InMemorySessionRepository(),
        undefined,
        undefined,
        schedules
      );

      await expect(
        service.routeInbound(message({ text: "/schedule delete 1 2" }))
      ).resolves.toMatchObject({
        command: "schedule-delete",
        text: expect.stringContaining("Deleted 2 schedules")
      });
      expect(deleted).toEqual(["schedule-1", "schedule-2"]);
    });
  });
});

function createService(
  sessions: SessionRepositoryPort,
  clock: ClockPort | undefined = new MutableClock("2026-07-17T15:00:00.000Z"),
  preferences?: ConversationPreferencePort,
  schedules?: ScheduleRepositoryPort,
  scheduleDisplayTimezone = "UTC",
  approvalCommands?: {
    handle: (message: InboundMessageV1, command: ApprovalCommand) => Promise<string>;
  }
): SessionRoutingService {
  return new SessionRoutingService({
    sessions,
    ...(preferences ? { preferences } : {}),
    ...(schedules ? { schedules } : {}),
    clock: clock ?? new MutableClock("2026-07-17T15:00:00.000Z"),
    ids: new SequentialIdGenerator(),
    ...(approvalCommands ? { approvalCommands } : {}),
    agentCatalog: INITIAL_AGENT_CATALOG,
    config: {
      idleContinuationMs: 86_400_000,
      retentionMs: 604_800_000,
      scheduleDisplayTimezone
    }
  });
}

function scheduledJob(): ScheduledJobV1 {
  return {
    schemaVersion: 1,
    id: "schedule-1",
    workspaceId: "workspace-example",
    destinationConversationId: "!room:example",
    agentId: "brain",
    name: "Morning review",
    instruction: "Summarize priorities.",
    schedule: { type: "cron", expression: "0 9 * * 1-5", timezone: "Europe/Stockholm" },
    enabled: true,
    sessionPolicy: { type: "fresh" },
    notificationPolicy: "always",
    overlapPolicy: "skip",
    missedRunPolicy: "run_once",
    timeoutSeconds: 600,
    nextRunAt: "2026-07-18T07:00:00.000Z",
    createdAt: "2026-07-17T15:00:00.000Z",
    updatedAt: "2026-07-17T15:00:00.000Z",
    version: 1
  };
}

function message(input: {
  text: string;
  workspaceId?: string;
  threadRootExternalEventId?: string;
}): InboundMessageV1 {
  return {
    schemaVersion: 1,
    id: `inbound-${input.text.replace(/\W+/g, "-")}`,
    traceId: "trace-1",
    transport: "matrix",
    externalEventId: `$${input.text}`,
    conversationId: "!room:example",
    workspaceId: input.workspaceId ?? "workspace-example",
    senderId: "@owner:example",
    receivedAt: "2026-07-17T15:00:00.000Z",
    kind: input.text.startsWith("/") ? "command" : "text",
    text: input.text,
    attachments: [],
    ...(input.threadRootExternalEventId
      ? { threadRootExternalEventId: input.threadRootExternalEventId }
      : {}),
    metadata: {}
  };
}

class MutableClock implements ClockPort {
  private current: Date;

  constructor(initial: string) {
    this.current = new Date(initial);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(timestamp: string): void {
    this.current = new Date(timestamp);
  }
}

class SequentialIdGenerator implements IdGeneratorPort {
  private next = 1;

  nextId(prefix: string): string {
    const id = `${prefix}-${this.next}`;
    this.next += 1;
    return id;
  }
}

class InMemoryConversationPreferences implements ConversationPreferencePort {
  private readonly values = new Map<string, boolean>();
  private readonly contexts = new Map<string, { mode?: "persistent"; historyLimit?: number }>();

  async getVoiceReplies(input: {
    conversationId: string;
    threadRootExternalEventId?: string;
  }): Promise<boolean> {
    return (
      this.values.get(`${input.conversationId}:${input.threadRootExternalEventId ?? ""}`) ?? false
    );
  }

  async setVoiceReplies(input: {
    conversationId: string;
    threadRootExternalEventId?: string;
    enabled: boolean;
  }): Promise<boolean> {
    this.values.set(
      `${input.conversationId}:${input.threadRootExternalEventId ?? ""}`,
      input.enabled
    );
    return input.enabled;
  }

  async getSessionContext(input: {
    conversationId: string;
    threadRootExternalEventId?: string;
  }): Promise<{ mode?: "persistent"; historyLimit?: number }> {
    return (
      this.contexts.get(`${input.conversationId}:${input.threadRootExternalEventId ?? ""}`) ?? {}
    );
  }

  async setSessionContext(input: {
    conversationId: string;
    threadRootExternalEventId?: string;
    mode?: "persistent";
    historyLimit?: number;
  }): Promise<{ mode?: "persistent"; historyLimit?: number }> {
    const value = {
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.historyLimit !== undefined ? { historyLimit: input.historyLimit } : {})
    };
    this.contexts.set(`${input.conversationId}:${input.threadRootExternalEventId ?? ""}`, value);
    return value;
  }
}

class InMemorySessionRepository implements SessionRepositoryPort {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly bindings = new Map<string, string>();

  async getActiveBinding(input: {
    workspaceId?: string;
    conversationId: string;
    threadRootExternalEventId?: string;
    scheduleId?: string;
  }): Promise<SessionRecord | undefined> {
    const sessionId = this.bindings.get(this.bindingKey(input));
    return sessionId ? this.sessions.get(sessionId) : undefined;
  }

  async create(session: SessionRecord): Promise<SessionRecord> {
    this.sessions.set(session.id, session);
    return session;
  }

  async createAndBind(input: {
    session: SessionRecord;
    workspaceId?: string;
    conversationId: string;
    threadRootExternalEventId?: string;
    scheduleId?: string;
  }): Promise<SessionRecord> {
    await this.create(input.session);
    this.bindings.set(this.bindingKey(input), input.session.id);
    return input.session;
  }

  async activateBinding(input: {
    sessionId: string;
    workspaceId?: string;
    conversationId: string;
    threadRootExternalEventId?: string;
    scheduleId?: string;
  }): Promise<SessionRecord> {
    const session = await this.get(input.sessionId, input.workspaceId);
    if (!session) {
      throw new Error(`Unknown session: ${input.sessionId}`);
    }
    this.bindings.set(this.bindingKey(input), session.id);
    return session;
  }

  async get(id: string, workspaceId?: string): Promise<SessionRecord | undefined> {
    if (!workspaceId) throw new Error("workspaceId is required");
    const session = this.sessions.get(id);
    return session?.workspaceId === workspaceId ? session : undefined;
  }

  async listRecent(input: {
    workspaceId?: string;
    now: Date;
    limit: number;
    includeClosed: boolean;
  }): Promise<SessionRecord[]> {
    if (!input.workspaceId) throw new Error("workspaceId is required");
    return [...this.sessions.values()]
      .filter((session) => session.workspaceId === input.workspaceId)
      .filter((session) => input.includeClosed || session.status !== "closed")
      .filter((session) => session.absoluteExpiresAt.getTime() > input.now.getTime())
      .sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime())
      .slice(0, input.limit);
  }

  async touch(input: {
    sessionId: string;
    workspaceId?: string;
    now: Date;
  }): Promise<SessionRecord> {
    const session = await this.get(input.sessionId, input.workspaceId);
    if (!session) {
      throw new Error(`Unknown session: ${input.sessionId}`);
    }
    const updated = { ...session, lastActiveAt: input.now };
    this.sessions.set(updated.id, updated);
    return updated;
  }

  async close(input: {
    sessionId: string;
    workspaceId?: string;
    now: Date;
  }): Promise<SessionRecord> {
    const session = await this.get(input.sessionId, input.workspaceId);
    if (!session) {
      throw new Error(`Unknown session: ${input.sessionId}`);
    }
    const updated: SessionRecord = { ...session, status: "closed", lastActiveAt: input.now };
    this.sessions.set(updated.id, updated);
    return updated;
  }

  snapshot(): SessionRecord[] {
    return [...this.sessions.values()];
  }

  private bindingKey(input: {
    workspaceId?: string;
    session?: SessionRecord;
    conversationId?: string;
    threadRootExternalEventId?: string;
    scheduleId?: string;
  }): string {
    const workspaceId = input.workspaceId ?? input.session?.workspaceId;
    if (!workspaceId) throw new Error("workspaceId is required");
    return [
      workspaceId,
      input.conversationId ?? "",
      input.threadRootExternalEventId ?? "",
      input.scheduleId ?? ""
    ].join("\u001f");
  }
}
