import type { QueryResult, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import type { PostgresQueryable } from "../postgres-queryable.js";
import { PostgresConversationPreferenceRepository } from "./conversation-preference-repository.js";
import { PostgresWorkspacePluginBindingRepository } from "./workspace-plugin-binding-repository.js";

describe("typed Postgres repositories", () => {
  it("scopes conversation preferences and handles a null thread root", async () => {
    const db = new RecordingDb([{ voice_replies_enabled: true }]);
    const repository = new PostgresConversationPreferenceRepository(db);

    await expect(
      repository.getVoiceReplies({ workspaceId: "workspace-1", conversationId: "room-1" })
    ).resolves.toBe(true);

    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]?.sql).toContain('from "brain_core"."conversation_preferences"');
    expect(db.calls[0]?.sql).toContain("is not distinct from");
    expect(db.calls[0]?.parameters).toEqual(["workspace-1", "room-1", null]);
  });

  it("upserts plugin configuration with typed values", async () => {
    const db = new RecordingDb([]);
    const repository = new PostgresWorkspacePluginBindingRepository(db);
    const updatedAt = new Date("2026-09-13T10:00:00.000Z");

    await repository.upsert({
      workspaceId: "workspace-1",
      pluginId: "calendar",
      pluginVersion: "1.0.0",
      enabledAgents: ["brain"],
      configuration: { calendarId: "primary" },
      credentialRef: "secret/calendar",
      updatedAt
    });

    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]?.sql).toContain('insert into "brain_core"."workspace_plugin_bindings"');
    expect(db.calls[0]?.sql).toContain("on conflict");
    expect(db.calls[0]?.parameters).toContain(updatedAt);
    expect(db.calls[0]?.parameters).toContainEqual({ calendarId: "primary" });
  });

  it("executes on an already leased pg client without reconnecting it", async () => {
    const db = new PoolClientLikeDb([{ voice_replies_enabled: true }]);
    const repository = new PostgresConversationPreferenceRepository(db);

    await expect(
      repository.getVoiceReplies({ workspaceId: "workspace-1", conversationId: "room-1" })
    ).resolves.toBe(true);

    expect(db.connectCalls).toBe(0);
    expect(db.calls).toHaveLength(1);
  });
});

class RecordingDb implements PostgresQueryable {
  readonly calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];

  constructor(private readonly rows: QueryResultRow[]) {}

  async query<Row extends QueryResultRow = QueryResultRow>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<QueryResult<Row>> {
    this.calls.push({ sql, parameters });
    const command = sql.trimStart().slice(0, 6).toUpperCase();
    return {
      rows: this.rows as Row[],
      command,
      rowCount: this.rows.length,
      oid: 0,
      fields: []
    };
  }
}

class PoolClientLikeDb extends RecordingDb {
  connectCalls = 0;

  connect(): never {
    this.connectCalls += 1;
    throw new Error("Client has already been connected. You cannot reuse a client.");
  }

  release(): void {}
}
