import type { SessionRepositoryPort } from "@second-brain/application/ports/sessions";
import { requireWorkspaceId, type RoomAgentId, type SessionRecord } from "@second-brain/domain";
import { sql } from "kysely";

import type { PostgresQueryable } from "../postgres-queryable.js";
import { rowToSession } from "../session-row.js";
import { typedDatabase, type TypedPostgresDatabase } from "../typed-database.js";

export interface PostgresSessionRepositoryOptions {
  db: PostgresQueryable;
}

export class PostgresSessionRepository implements SessionRepositoryPort {
  private readonly db: TypedPostgresDatabase;

  constructor(options: PostgresSessionRepositoryOptions) {
    this.db = typedDatabase(options.db);
  }

  async getActiveBinding(input: {
    workspaceId?: string;
    conversationId: string;
    threadRootExternalEventId?: string;
    scheduleId?: string;
    agentId?: RoomAgentId;
  }): Promise<SessionRecord | undefined> {
    const row = await this.db
      .withSchema("brain_core")
      .selectFrom("sessions")
      .innerJoin("session_bindings as bindings", "bindings.active_session_id", "sessions.id")
      .selectAll("sessions")
      .where(
        "bindings.workspace_id",
        "=",
        requireWorkspaceId(input.workspaceId, "Active session binding lookup")
      )
      .where("bindings.agent_id", "=", input.agentId ?? "brain")
      .where("bindings.conversation_id", "is not distinct from", input.conversationId)
      .where(
        "bindings.thread_root_external_event_id",
        "is not distinct from",
        input.threadRootExternalEventId ?? null
      )
      .where("bindings.schedule_id", "is not distinct from", input.scheduleId ?? null)
      .executeTakeFirst();
    return row ? rowToSession(row) : undefined;
  }

  async create(session: SessionRecord): Promise<SessionRecord> {
    await this.upsertSession(session);
    return session;
  }

  async createAndBind(input: {
    session: SessionRecord;
    workspaceId?: string;
    conversationId: string;
    threadRootExternalEventId?: string;
    scheduleId?: string;
    agentId?: RoomAgentId;
  }): Promise<SessionRecord> {
    await this.create(input.session);
    await this.upsertBinding(input);
    return input.session;
  }

  async activateBinding(input: {
    sessionId: string;
    workspaceId?: string;
    conversationId: string;
    threadRootExternalEventId?: string;
    scheduleId?: string;
    agentId?: RoomAgentId;
  }): Promise<SessionRecord> {
    const session = await this.get(input.sessionId, input.workspaceId);
    if (!session) {
      throw new Error(`Unknown session: ${input.sessionId}`);
    }
    await this.upsertBinding({
      session,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      conversationId: input.conversationId,
      ...(input.threadRootExternalEventId
        ? { threadRootExternalEventId: input.threadRootExternalEventId }
        : {}),
      ...(input.scheduleId ? { scheduleId: input.scheduleId } : {}),
      ...(input.agentId ? { agentId: input.agentId } : {})
    });
    return session;
  }

  async get(id: string, workspaceId?: string): Promise<SessionRecord | undefined> {
    const row = await sessionQuery(this.db)
      .where("id", "=", id)
      .where("workspace_id", "=", requireWorkspaceId(workspaceId, "Session lookup"))
      .executeTakeFirst();
    return row ? rowToSession(row) : undefined;
  }

  async listRecent(input: {
    workspaceId?: string;
    now: Date;
    limit: number;
    includeClosed: boolean;
  }): Promise<SessionRecord[]> {
    let query = sessionQuery(this.db)
      .where("workspace_id", "=", requireWorkspaceId(input.workspaceId, "Session listing"))
      .where("absolute_expires_at", ">", input.now);
    if (!input.includeClosed) query = query.where("status", "!=", "closed");
    const rows = await query
      .orderBy("last_active_at", "desc")
      .orderBy("id", "asc")
      .limit(input.limit)
      .execute();
    return rows.map(rowToSession);
  }

  async touch(input: {
    sessionId: string;
    workspaceId?: string;
    now: Date;
  }): Promise<SessionRecord> {
    const row = await this.db
      .withSchema("brain_core")
      .updateTable("sessions")
      .set({
        last_active_at: input.now,
        idle_expires_at: new Date(input.now.getTime() + 86_400_000),
        version: sql<number>`version + 1`
      })
      .where("id", "=", input.sessionId)
      .where("workspace_id", "=", requireWorkspaceId(input.workspaceId, "Session touch"))
      .returningAll()
      .executeTakeFirst();
    if (!row) {
      throw new Error(`Unknown session: ${input.sessionId}`);
    }
    return rowToSession(row);
  }

  async close(input: {
    sessionId: string;
    workspaceId?: string;
    now: Date;
  }): Promise<SessionRecord> {
    const row = await this.db
      .withSchema("brain_core")
      .updateTable("sessions")
      .set({ status: "closed", last_active_at: input.now, version: sql<number>`version + 1` })
      .where("id", "=", input.sessionId)
      .where("workspace_id", "=", requireWorkspaceId(input.workspaceId, "Session close"))
      .returningAll()
      .executeTakeFirst();
    if (!row) {
      throw new Error(`Unknown session: ${input.sessionId}`);
    }
    return rowToSession(row);
  }

  private async upsertSession(session: SessionRecord): Promise<void> {
    const values = sessionValues(session);
    await this.db
      .withSchema("brain_core")
      .insertInto("sessions")
      .values(values)
      .onConflict((conflict) =>
        conflict.column("id").doUpdateSet({
          label: values.label,
          status: values.status,
          last_active_at: values.last_active_at,
          idle_expires_at: values.idle_expires_at,
          absolute_expires_at: values.absolute_expires_at,
          pi_session_key: values.pi_session_key,
          source_type: values.source_type,
          source_conversation_id: values.source_conversation_id,
          source_thread_root_id: values.source_thread_root_id,
          source_schedule_id: values.source_schedule_id,
          version: sql<number>`sessions.version + 1`
        })
      )
      .execute();
  }

  private async upsertBinding(input: {
    session: SessionRecord;
    workspaceId?: string;
    conversationId: string;
    threadRootExternalEventId?: string;
    scheduleId?: string;
    agentId?: RoomAgentId;
  }): Promise<void> {
    await this.db
      .withSchema("brain_core")
      .insertInto("session_bindings")
      .values({
        id: bindingId(input),
        workspace_id: workspaceId(input),
        agent_id: input.agentId ?? "brain",
        conversation_id: input.conversationId,
        thread_root_external_event_id: input.threadRootExternalEventId ?? null,
        schedule_id: input.scheduleId ?? null,
        active_session_id: input.session.id
      })
      .onConflict((conflict) =>
        conflict
          .columns([
            "workspace_id",
            "agent_id",
            "conversation_id",
            "thread_root_external_event_id",
            "schedule_id"
          ])
          .doUpdateSet({
            active_session_id: input.session.id,
            version: sql<number>`session_bindings.version + 1`,
            updated_at: sql`now()`
          })
      )
      .execute();
  }
}

function sessionValues(session: SessionRecord) {
  return {
    id: session.id,
    workspace_id: requireWorkspaceId(session.workspaceId, "Session persistence"),
    label: session.label ?? null,
    status: session.status,
    created_at: session.createdAt,
    last_active_at: session.lastActiveAt,
    idle_expires_at: session.idleExpiresAt,
    absolute_expires_at: session.absoluteExpiresAt,
    pi_session_key: session.piSessionKey,
    source_type: session.sourceType,
    source_conversation_id: session.sourceConversationId ?? null,
    source_thread_root_id: session.sourceThreadRootId ?? null,
    source_schedule_id: session.sourceScheduleId ?? null
  };
}

function sessionQuery(db: TypedPostgresDatabase) {
  return db.withSchema("brain_core").selectFrom("sessions").selectAll();
}

function bindingId(input: {
  workspaceId?: string;
  session: SessionRecord;
  conversationId?: string;
  threadRootExternalEventId?: string;
  scheduleId?: string;
  agentId?: RoomAgentId;
}): string {
  return `binding:${JSON.stringify([
    workspaceId(input),
    input.agentId ?? "brain",
    input.conversationId ?? "",
    input.threadRootExternalEventId ?? "",
    input.scheduleId ?? ""
  ])}`;
}

function workspaceId(input: { workspaceId?: string; session: SessionRecord }): string {
  return requireWorkspaceId(
    input.workspaceId ?? input.session.workspaceId,
    "Session binding persistence"
  );
}
