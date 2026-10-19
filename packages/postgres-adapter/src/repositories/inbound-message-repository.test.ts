import { describe, expect, it } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";

import { exampleAttachment, exampleInboundMessage } from "@second-brain/contracts/examples";

import { PostgresInboundMessageRepository } from "./inbound-message-repository.js";
import type { PostgresQueryable } from "../job-queue.js";

describe("PostgresInboundMessageRepository", () => {
  it("inserts inbound messages and attachment links", async () => {
    const message = { ...exampleInboundMessage, attachments: [exampleAttachment] };
    const db = new RecordingDb([[inboundRow()], [], []]);
    const repository = new PostgresInboundMessageRepository({ db });

    await expect(repository.create(message)).resolves.toEqual({ message, duplicate: false });

    expect(db.calls[0]?.sql).toContain('insert into "brain_core"."inbound_messages"');
    expect(db.calls[0]?.sql).toContain('on conflict ("transport", "external_event_id") do nothing');
    expect(db.calls[1]?.sql).toContain('insert into "brain_core"."attachments"');
    expect(db.calls[2]?.sql).toContain('insert into "brain_core"."inbound_message_attachments"');
  });

  it("returns the original message on duplicate transport event", async () => {
    const db = new RecordingDb([[], [inboundRow({ id: "inbound-original" })], []]);
    const repository = new PostgresInboundMessageRepository({ db });

    await expect(repository.create(exampleInboundMessage)).resolves.toMatchObject({
      duplicate: true,
      message: { id: "inbound-original", externalEventId: "$matrix-event-1" }
    });

    expect(db.calls[1]?.sql).toContain('where "transport" = $1');
    expect(db.calls[1]?.values).toEqual(["matrix", "$matrix-event-1"]);
  });

  it("loads messages with attachments", async () => {
    const db = new RecordingDb([[inboundRow()], [attachmentRow()]]);
    const repository = new PostgresInboundMessageRepository({ db });

    await expect(repository.get("inbound-1")).resolves.toMatchObject({
      id: "inbound-1",
      text: "Remember this note.",
      attachments: [{ id: "attachment-1", mediaType: "image/jpeg" }]
    });

    expect(db.calls[1]?.sql).toContain('"attachments"."workspace_id" = $3');
    expect(db.calls[1]?.values).toEqual(["inbound-1", "workspace-example", "workspace-example"]);

    expect(db.calls[0]?.sql).toContain('from "brain_core"."inbound_messages"');
    expect(db.calls[1]?.sql).toContain('inner join "brain_core"."inbound_message_attachments"');
  });

  it("preserves the selected specialized agent when loading a stored message", async () => {
    const db = new RecordingDb([[inboundRow({ agent_id: "planner" })], []]);
    const repository = new PostgresInboundMessageRepository({ db });

    await expect(repository.get("inbound-1")).resolves.toMatchObject({
      id: "inbound-1",
      agentId: "planner"
    });
  });

  it("persists and restores the Matrix profile timezone", async () => {
    const message = { ...exampleInboundMessage, userTimezone: "America/New_York" };
    const row = inboundRow({ metadata: { "org.second-brain.user_timezone": "America/New_York" } });
    const db = new RecordingDb([[row], [row], []]);
    const repository = new PostgresInboundMessageRepository({ db });

    await repository.create(message);
    expect(db.calls[0]?.values?.[15]).toEqual({
      "org.second-brain.user_timezone": "America/New_York"
    });

    await expect(repository.get("inbound-1")).resolves.toMatchObject({
      userTimezone: "America/New_York"
    });
  });

  it("lists messages for admin inspection", async () => {
    const db = new RecordingDb([
      [inboundRow({ id: "inbound-1" }), inboundRow({ id: "inbound-2" })],
      [],
      []
    ]);
    const repository = new PostgresInboundMessageRepository({ db });

    await expect(repository.snapshot()).resolves.toMatchObject([
      { id: "inbound-1" },
      { id: "inbound-2" }
    ]);
    expect(db.calls[0]?.sql).toContain('order by "received_at" asc');
  });

  it("returns only bounded conversational messages from the current workspace thread", async () => {
    const db = new RecordingDb([
      [
        { sender: "user", text_content: "First", occurred_at: "2026-08-14T10:00:00.000Z" },
        { sender: "jarvis", text_content: "Second", occurred_at: "2026-08-14T10:00:01.000Z" }
      ]
    ]);
    const repository = new PostgresInboundMessageRepository({ db });

    await expect(
      repository.listThreadHistory({
        message: {
          ...exampleInboundMessage,
          workspaceId: "workspace-1",
          threadRootExternalEventId: "$root"
        },
        limit: 99
      })
    ).resolves.toEqual([
      { sender: "jarvis", text: "Second", occurredAt: "2026-08-14T10:00:01.000Z" },
      { sender: "user", text: "First", occurredAt: "2026-08-14T10:00:00.000Z" }
    ]);
    expect(db.calls[0]?.sql).toContain('from "brain_core"."outbound_messages"');
    expect(db.calls[0]?.sql).toContain('"kind" != $5');
    expect(db.calls[0]?.sql).toContain('"presentation" = $9');
    expect(db.calls[0]?.sql).toContain('"idempotency_key" not in');
    expect(db.calls[0]?.sql).toContain("audio_transcript");
    expect(db.calls[0]?.values).toEqual([
      "workspace-1",
      "!room:example",
      "$root",
      "inbound-1",
      "command",
      "workspace-1",
      "!room:example",
      "$root",
      "assistant",
      "command",
      99
    ]);
  });

  it("stores an audio transcript only for the selected workspace and audio message", async () => {
    const db = new RecordingDb([[{ id: "inbound-audio-1" }]]);
    const repository = new PostgresInboundMessageRepository({ db });

    await repository.saveAudioTranscript({
      id: "inbound-audio-1",
      workspaceId: "workspace-1",
      text: "Remember the blue folder."
    });

    expect(db.calls[0]?.sql).toContain('update "brain_core"."inbound_messages"');
    expect(db.calls[0]?.sql).toContain('"audio_transcript" = $1');
    expect(db.calls[0]?.values).toEqual([
      "Remember the blue folder.",
      "inbound-audio-1",
      "workspace-1",
      "audio"
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

function inboundRow(overrides: QueryResultRow = {}): QueryResultRow {
  return {
    id: "inbound-1",
    schema_version: 1,
    trace_id: "trace-1",
    transport: "matrix",
    external_event_id: "$matrix-event-1",
    conversation_id: "!room:example",
    workspace_id: "workspace-example",
    agent_id: "brain",
    sender_id: "@owner:example",
    received_at: "2026-07-17T15:00:00.000Z",
    kind: "text",
    text_content: "Remember this note.",
    reply_to_external_event_id: null,
    thread_root_external_event_id: null,
    replaces_external_event_id: null,
    metadata: {},
    ...overrides
  };
}

function attachmentRow(overrides: QueryResultRow = {}): QueryResultRow {
  return {
    id: "attachment-1",
    schema_version: 1,
    purpose: "inbound",
    media_type: "image/jpeg",
    size_bytes: 1024,
    sha256: "0".repeat(64),
    storage_key: "inbound/message-1/attachment-1",
    original_filename: "photo.jpg",
    duration_ms: null,
    width: 1280,
    height: 720,
    ...overrides
  };
}
