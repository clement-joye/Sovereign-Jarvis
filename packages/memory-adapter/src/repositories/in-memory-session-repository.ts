import type { SessionRepositoryPort } from "@second-brain/application";
import type { SessionRecord } from "@second-brain/domain";
import { requireWorkspaceId } from "@second-brain/domain";

export class InMemorySessionRepository implements SessionRepositoryPort {
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
    const session = this.sessions.get(input.sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${input.sessionId}`);
    }
    this.bindings.set(this.bindingKey(input), input.sessionId);
    return session;
  }

  async get(id: string, workspaceId?: string): Promise<SessionRecord | undefined> {
    const session = this.sessions.get(id);
    return session &&
      requireWorkspaceId(session.workspaceId, "Stored session") ===
        requireWorkspaceId(workspaceId, "Session lookup")
      ? session
      : undefined;
  }

  async listRecent(input: {
    workspaceId?: string;
    now: Date;
    limit: number;
    includeClosed: boolean;
  }): Promise<SessionRecord[]> {
    return [...this.sessions.values()]
      .filter(
        (session) =>
          requireWorkspaceId(session.workspaceId, "Stored session") ===
          requireWorkspaceId(input.workspaceId, "Session binding lookup")
      )
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
    const session = this.require(input.sessionId, input.workspaceId);
    const updated: SessionRecord = {
      ...session,
      lastActiveAt: input.now,
      idleExpiresAt: new Date(input.now.getTime() + 86_400_000)
    };
    this.sessions.set(updated.id, updated);
    return updated;
  }

  async close(input: {
    sessionId: string;
    workspaceId?: string;
    now: Date;
  }): Promise<SessionRecord> {
    const session = this.require(input.sessionId, input.workspaceId);
    const updated: SessionRecord = {
      ...session,
      status: "closed",
      lastActiveAt: input.now
    };
    this.sessions.set(updated.id, updated);
    return updated;
  }

  snapshot(): SessionRecord[] {
    return [...this.sessions.values()];
  }

  private require(sessionId: string, workspaceId?: string): SessionRecord {
    const session = this.sessions.get(sessionId);
    if (
      !session ||
      requireWorkspaceId(session.workspaceId, "Stored session") !==
        requireWorkspaceId(workspaceId, "Session lookup")
    ) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return session;
  }

  private bindingKey(input: {
    workspaceId?: string;
    session?: SessionRecord;
    conversationId?: string;
    threadRootExternalEventId?: string;
    scheduleId?: string;
  }): string {
    return [
      requireWorkspaceId(
        input.workspaceId ?? input.session?.workspaceId,
        "Session binding persistence"
      ),
      input.conversationId ?? "",
      input.threadRootExternalEventId ?? "",
      input.scheduleId ?? ""
    ].join("\u001f");
  }
}
