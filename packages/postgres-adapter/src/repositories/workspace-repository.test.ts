import { describe, expect, it } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";

import type { WorkspaceRecord } from "@second-brain/domain";

import type { PostgresQueryable } from "../job-queue.js";
import { PostgresWorkspaceRepository } from "./workspace-repository.js";

describe("PostgresWorkspaceRepository", () => {
  it("stores the selected agent independently for each room thread", async () => {
    const db = new RecordingDb([[], [{ agent_id: "router" }]]);
    const repository = new PostgresWorkspaceRepository(db);
    await repository.setThreadAgent({
      workspaceId: "workspace-1",
      conversationId: "!room:example",
      threadRootExternalEventId: "$thread",
      agentId: "router",
      updatedAt: new Date("2026-08-13T20:00:00.000Z")
    });
    await expect(
      repository.getThreadAgent({
        workspaceId: "workspace-1",
        conversationId: "!room:example",
        threadRootExternalEventId: "$thread"
      })
    ).resolves.toBe("router");
    expect(db.calls[0]?.sql).toContain("thread_agent_selections");
    expect(db.calls[0]?.values?.slice(0, 5)).toEqual([
      "workspace-1",
      "!room:example",
      "$thread",
      "router",
      new Date("2026-08-13T20:00:00.000Z")
    ]);
  });
  it("creates a workspace with its pinned template configuration", async () => {
    const db = new RecordingDb([[workspaceRow()]]);
    const repository = new PostgresWorkspaceRepository(db);

    await expect(repository.create(workspace())).resolves.toMatchObject({
      id: "workspace-1",
      templateId: "second-brain",
      configuration: { retentionDays: 7 }
    });

    expect(db.calls[0]?.sql).toContain('insert into "brain_core"."workspaces"');
    expect(db.calls[0]?.values?.[3]).toEqual({ retentionDays: 7 });
  });

  it("resolves only active workspace bindings for a Matrix room", async () => {
    const db = new RecordingDb([[workspaceRow()]]);
    const repository = new PostgresWorkspaceRepository(db);

    await expect(repository.getActiveByRoomId("!brain:example")).resolves.toMatchObject({
      id: "workspace-1",
      status: "active"
    });

    expect(db.calls[0]?.sql).toContain('inner join "brain_core"."workspace_room_bindings"');
    expect(db.calls[0]?.values).toEqual(["!brain:example", "active", "active"]);
  });

  it("finds a room-bound workspace before it becomes active", async () => {
    const db = new RecordingDb([[workspaceRow({ status: "configuring" })]]);
    const repository = new PostgresWorkspaceRepository(db);

    await expect(repository.getByRoomId("!project:example")).resolves.toMatchObject({
      id: "workspace-1",
      status: "configuring"
    });

    expect(db.calls[0]?.sql).toContain('"bindings"."room_id" = $1');
    expect(db.calls[0]?.values).toEqual(["!project:example"]);
  });

  it("upserts one room binding without allowing duplicate room ownership", async () => {
    const db = new RecordingDb([[roomBindingRow()]]);
    const repository = new PostgresWorkspaceRepository(db);

    await expect(
      repository.bindRoom({
        id: "binding-1",
        workspaceId: "workspace-1",
        roomId: "!brain:example",
        status: "active",
        createdAt: new Date("2026-08-03T10:00:00.000Z")
      })
    ).resolves.toMatchObject({ workspaceId: "workspace-1", roomId: "!brain:example" });

    expect(db.calls[0]?.sql).toContain('on conflict ("room_id") do update');
    expect(db.calls[0]?.values?.slice(0, 6)).toEqual([
      "binding-1",
      "workspace-1",
      "!brain:example",
      "active",
      new Date("2026-08-03T10:00:00.000Z"),
      null
    ]);
  });
});

class RecordingDb implements PostgresQueryable {
  readonly calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
  private resultIndex = 0;

  constructor(private readonly rows: QueryResultRow[][]) {}

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<T>> {
    this.calls.push(values ? { sql: text, values } : { sql: text });
    const rows = (this.rows[this.resultIndex] ?? []) as T[];
    this.resultIndex += 1;
    return { command: "SELECT", oid: 0, fields: [], rows, rowCount: rows.length };
  }
}

function workspace(): WorkspaceRecord {
  const now = new Date("2026-08-03T10:00:00.000Z");
  return {
    id: "workspace-1",
    templateId: "second-brain",
    templateVersion: "1.0.0",
    configuration: { retentionDays: 7 },
    status: "active",
    origin: "matrix_invite",
    createdAt: now,
    updatedAt: now,
    activatedAt: now
  };
}

function workspaceRow(overrides: QueryResultRow = {}): QueryResultRow {
  return {
    id: "workspace-1",
    template_id: "second-brain",
    template_version: "1.0.0",
    configuration: { retentionDays: 7 },
    status: "active",
    origin: "matrix_invite",
    created_at: "2026-08-03T10:00:00.000Z",
    updated_at: "2026-08-03T10:00:00.000Z",
    activated_at: "2026-08-03T10:00:00.000Z",
    archived_at: null,
    closed_at: null,
    ...overrides
  };
}

function roomBindingRow(overrides: QueryResultRow = {}): QueryResultRow {
  return {
    id: "binding-1",
    workspace_id: "workspace-1",
    room_id: "!brain:example",
    status: "active",
    created_at: "2026-08-03T10:00:00.000Z",
    archived_at: null,
    ...overrides
  };
}
