import { describe, expect, it } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";

import type { SessionRecord } from "@second-brain/domain";

import type { PostgresQueryable } from "../job-queue.js";
import { PostgresSessionRepository } from "./session-repository.js";

describe("PostgresSessionRepository", () => {
  it("creates sessions and upserts active bindings", async () => {
    const db = new RecordingDb([[], []]);
    const repository = new PostgresSessionRepository({ db });

    await expect(
      repository.createAndBind({
        session: sessionRecord(),
        workspaceId: "workspace-example",
        conversationId: "!room:example"
      })
    ).resolves.toMatchObject({ id: "session-1" });

    expect(db.calls[0]?.sql).toContain('insert into "brain_core"."sessions"');
    expect(db.calls[1]?.sql).toContain('insert into "brain_core"."session_bindings"');
    expect(db.calls[1]?.sql).toContain(
      'on conflict ("workspace_id", "agent_id", "conversation_id", "thread_root_external_event_id", "schedule_id")'
    );
  });

  it("resolves active bindings with null-safe matching", async () => {
    const db = new RecordingDb([[sessionRow()]]);
    const repository = new PostgresSessionRepository({ db });

    await expect(
      repository.getActiveBinding({
        workspaceId: "workspace-example",
        conversationId: "!room:example"
      })
    ).resolves.toMatchObject({
      id: "session-1",
      sourceType: "default-room"
    });

    expect(db.calls[0]?.sql).toContain('"bindings"."workspace_id" = $1');
    expect(db.calls[0]?.sql).toContain('"bindings"."agent_id" = $2');
    expect(db.calls[0]?.sql).toContain("is not distinct from $3");
    expect(db.calls[0]?.values).toEqual([
      "workspace-example",
      "brain",
      "!room:example",
      null,
      null
    ]);
  });

  it("activates an existing session binding", async () => {
    const db = new RecordingDb([[sessionRow()], []]);
    const repository = new PostgresSessionRepository({ db });

    await expect(
      repository.activateBinding({
        sessionId: "session-1",
        workspaceId: "workspace-example",
        conversationId: "!room:example",
        threadRootExternalEventId: "$thread"
      })
    ).resolves.toMatchObject({ id: "session-1" });

    expect(db.calls[0]?.sql).toContain('where "id" = $1');
    expect(db.calls[1]?.values?.slice(0, 7)).toEqual([
      'binding:["workspace-example","brain","!room:example","$thread",""]',
      "workspace-example",
      "brain",
      "!room:example",
      "$thread",
      null,
      "session-1"
    ]);
  });

  it("touches and closes sessions", async () => {
    const db = new RecordingDb([
      [sessionRow({ last_active_at: "2026-07-17T16:00:00.000Z" })],
      [sessionRow({ status: "closed" })]
    ]);
    const repository = new PostgresSessionRepository({ db });

    await expect(
      repository.touch({
        sessionId: "session-1",
        workspaceId: "workspace-example",
        now: new Date("2026-07-17T16:00:00.000Z")
      })
    ).resolves.toMatchObject({ lastActiveAt: new Date("2026-07-17T16:00:00.000Z") });
    await expect(
      repository.close({
        sessionId: "session-1",
        workspaceId: "workspace-example",
        now: new Date("2026-07-17T17:00:00.000Z")
      })
    ).resolves.toMatchObject({ status: "closed" });

    expect(db.calls[0]?.sql).toContain('"idle_expires_at" = $2');
    expect(db.calls[0]?.sql).toContain('where "id" = $3 and "workspace_id" = $4');
    expect(db.calls[1]?.values?.[0]).toBe("closed");
  });

  it("lists recent non-expired sessions", async () => {
    const db = new RecordingDb([[sessionRow(), sessionRow({ id: "session-2" })]]);
    const repository = new PostgresSessionRepository({ db });

    await expect(
      repository.listRecent({
        workspaceId: "workspace-example",
        now: new Date("2026-07-17T15:00:00.000Z"),
        limit: 10,
        includeClosed: false
      })
    ).resolves.toMatchObject([{ id: "session-1" }, { id: "session-2" }]);

    expect(db.calls[0]?.sql).toContain('"workspace_id" = $1');
    expect(db.calls[0]?.sql).toContain('"absolute_expires_at" > $2');
    expect(db.calls[0]?.values).toEqual([
      "workspace-example",
      new Date("2026-07-17T15:00:00.000Z"),
      "closed",
      10
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
    return {
      command: "SELECT",
      oid: 0,
      fields: [],
      rows,
      rowCount: rows.length
    };
  }
}

function sessionRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const now = new Date("2026-07-17T15:00:00.000Z");
  return {
    id: "session-1",
    workspaceId: "workspace-example",
    status: "active",
    createdAt: now,
    lastActiveAt: now,
    idleExpiresAt: new Date("2026-07-18T15:00:00.000Z"),
    absoluteExpiresAt: new Date("2026-07-24T15:00:00.000Z"),
    piSessionKey: "session-1",
    sourceType: "default-room",
    sourceConversationId: "!room:example",
    ...overrides
  };
}

function sessionRow(overrides: QueryResultRow = {}): QueryResultRow {
  return {
    id: "session-1",
    workspace_id: "workspace-example",
    label: null,
    status: "active",
    created_at: "2026-07-17T15:00:00.000Z",
    last_active_at: "2026-07-17T15:00:00.000Z",
    idle_expires_at: "2026-07-18T15:00:00.000Z",
    absolute_expires_at: "2026-07-24T15:00:00.000Z",
    pi_session_key: "session-1",
    source_type: "default-room",
    source_conversation_id: "!room:example",
    source_thread_root_id: null,
    source_schedule_id: null,
    ...overrides
  };
}
