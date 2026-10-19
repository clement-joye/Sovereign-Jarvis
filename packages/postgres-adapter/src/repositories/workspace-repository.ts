import type { WorkspaceRepositoryPort } from "@second-brain/application/ports/workspace";
import type {
  RoomAgentId,
  WorkspaceRecord,
  WorkspaceRoomBindingRecord
} from "@second-brain/domain";
import type { Selectable } from "kysely";

import type { WorkspaceRoomBindingsTable, WorkspacesTable } from "../database-schema.js";
import type { PostgresQueryable } from "../postgres-queryable.js";
import { typedDatabase, type TypedPostgresDatabase } from "../typed-database.js";

type WorkspaceRow = Selectable<WorkspacesTable>;
type WorkspaceRoomBindingRow = Selectable<WorkspaceRoomBindingsTable>;

export class PostgresWorkspaceRepository implements WorkspaceRepositoryPort {
  private readonly db: TypedPostgresDatabase;

  constructor(queryable: PostgresQueryable) {
    this.db = typedDatabase(queryable);
  }

  async create(workspace: WorkspaceRecord): Promise<WorkspaceRecord> {
    const row = await this.db
      .withSchema("brain_core")
      .insertInto("workspaces")
      .values(workspaceInsert(workspace))
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new Error(`Workspace was not created: ${workspace.id}`);
    return rowToWorkspace(row);
  }

  async update(workspace: WorkspaceRecord): Promise<WorkspaceRecord> {
    const row = await this.db
      .withSchema("brain_core")
      .updateTable("workspaces")
      .set({
        template_id: workspace.templateId,
        template_version: workspace.templateVersion,
        configuration: workspace.configuration,
        default_agent: workspace.defaultAgent ?? "brain",
        status: workspace.status,
        updated_at: workspace.updatedAt,
        activated_at: workspace.activatedAt ?? null,
        archived_at: workspace.archivedAt ?? null,
        closed_at: workspace.closedAt ?? null
      })
      .where("id", "=", workspace.id)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new Error(`Unknown workspace: ${workspace.id}`);
    return rowToWorkspace(row);
  }

  async get(id: string): Promise<WorkspaceRecord | undefined> {
    const row = await workspaceQuery(this.db).where("workspaces.id", "=", id).executeTakeFirst();
    return row ? rowToWorkspace(row) : undefined;
  }

  async list(): Promise<WorkspaceRecord[]> {
    const rows = await workspaceQuery(this.db)
      .orderBy("workspaces.created_at", "asc")
      .orderBy("workspaces.id", "asc")
      .execute();
    return rows.map(rowToWorkspace);
  }

  async getByRoomId(roomId: string): Promise<WorkspaceRecord | undefined> {
    return this.getByRoomIdAndStatus(roomId, false);
  }

  async getActiveByRoomId(roomId: string): Promise<WorkspaceRecord | undefined> {
    return this.getByRoomIdAndStatus(roomId, true);
  }

  async bindRoom(binding: WorkspaceRoomBindingRecord): Promise<WorkspaceRoomBindingRecord> {
    const row = await this.db
      .withSchema("brain_core")
      .insertInto("workspace_room_bindings")
      .values({
        id: binding.id,
        workspace_id: binding.workspaceId,
        room_id: binding.roomId,
        status: binding.status,
        created_at: binding.createdAt,
        archived_at: binding.archivedAt ?? null
      })
      .onConflict((conflict) =>
        conflict.column("room_id").doUpdateSet({
          workspace_id: binding.workspaceId,
          status: binding.status,
          archived_at: binding.archivedAt ?? null
        })
      )
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new Error(`Room binding was not created: ${binding.roomId}`);
    return rowToRoomBinding(row);
  }

  async getThreadAgent(input: {
    workspaceId: string;
    conversationId: string;
    threadRootExternalEventId: string;
  }): Promise<RoomAgentId | undefined> {
    const row = await this.db
      .withSchema("brain_core")
      .selectFrom("thread_agent_selections")
      .select("agent_id")
      .where("workspace_id", "=", input.workspaceId)
      .where("conversation_id", "=", input.conversationId)
      .where("thread_root_external_event_id", "=", input.threadRootExternalEventId)
      .executeTakeFirst();
    return row?.agent_id;
  }

  async setThreadAgent(input: {
    workspaceId: string;
    conversationId: string;
    threadRootExternalEventId: string;
    agentId: RoomAgentId;
    updatedAt: Date;
  }): Promise<void> {
    await this.db
      .withSchema("brain_core")
      .insertInto("thread_agent_selections")
      .values({
        workspace_id: input.workspaceId,
        conversation_id: input.conversationId,
        thread_root_external_event_id: input.threadRootExternalEventId,
        agent_id: input.agentId,
        updated_at: input.updatedAt
      })
      .onConflict((conflict) =>
        conflict
          .columns(["workspace_id", "conversation_id", "thread_root_external_event_id"])
          .doUpdateSet({ agent_id: input.agentId, updated_at: input.updatedAt })
      )
      .execute();
  }

  private async getByRoomIdAndStatus(
    roomId: string,
    activeOnly: boolean
  ): Promise<WorkspaceRecord | undefined> {
    let query = workspaceQuery(this.db)
      .innerJoin("workspace_room_bindings as bindings", "bindings.workspace_id", "workspaces.id")
      .where("bindings.room_id", "=", roomId);
    if (activeOnly) {
      query = query
        .where("bindings.status", "=", "active")
        .where("workspaces.status", "=", "active");
    }
    const row = await query.executeTakeFirst();
    return row ? rowToWorkspace(row) : undefined;
  }
}

function workspaceQuery(db: TypedPostgresDatabase) {
  return db.withSchema("brain_core").selectFrom("workspaces").selectAll("workspaces");
}

function workspaceInsert(workspace: WorkspaceRecord) {
  return {
    id: workspace.id,
    template_id: workspace.templateId,
    template_version: workspace.templateVersion,
    configuration: workspace.configuration,
    default_agent: workspace.defaultAgent ?? "brain",
    status: workspace.status,
    origin: workspace.origin,
    created_at: workspace.createdAt,
    updated_at: workspace.updatedAt,
    activated_at: workspace.activatedAt ?? null,
    archived_at: workspace.archivedAt ?? null,
    closed_at: workspace.closedAt ?? null
  } as const;
}

function rowToWorkspace(row: WorkspaceRow): WorkspaceRecord {
  return {
    id: row.id,
    templateId: row.template_id,
    templateVersion: row.template_version,
    configuration: row.configuration,
    defaultAgent: row.default_agent,
    status: row.status,
    origin: row.origin,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    ...(row.activated_at ? { activatedAt: toDate(row.activated_at) } : {}),
    ...(row.archived_at ? { archivedAt: toDate(row.archived_at) } : {}),
    ...(row.closed_at ? { closedAt: toDate(row.closed_at) } : {})
  };
}

function rowToRoomBinding(row: WorkspaceRoomBindingRow): WorkspaceRoomBindingRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    roomId: row.room_id,
    status: row.status,
    createdAt: toDate(row.created_at),
    ...(row.archived_at ? { archivedAt: toDate(row.archived_at) } : {})
  };
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
