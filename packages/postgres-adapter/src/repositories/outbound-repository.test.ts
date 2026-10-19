import { describe, expect, it } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";

import type { PostgresQueryable } from "../job-queue.js";

import { PostgresOutboundRepository } from "./outbound-repository.js";

describe("PostgresOutboundRepository", () => {
  it("uses the workspace in outbound idempotency reads and writes", async () => {
    const db = new RecordingDb([[outboundRow()], []]);
    const repository = new PostgresOutboundRepository({ db });

    await expect(repository.getByIdempotencyKey("same", "workspace-one")).resolves.toMatchObject({
      id: "outbound-1",
      workspaceId: "workspace-one",
      presentation: "assistant"
    });

    expect(db.calls[0]?.sql).toContain('"workspace_id" = $1');
    expect(db.calls[0]?.values).toEqual(["workspace-one", "same"]);
    expect(db.calls[1]?.sql).toContain('"attachments"."workspace_id" = $3');
    expect(db.calls[1]?.values).toEqual(["outbound-1", "workspace-one", "workspace-one"]);
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

function outboundRow(): QueryResultRow {
  return {
    id: "outbound-1",
    schema_version: 1,
    trace_id: "trace-1",
    conversation_id: "!room:example",
    workspace_id: "workspace-one",
    text_content: "Done.",
    audio_attachment_id: null,
    reply_to_external_event_id: null,
    thread_root_external_event_id: null,
    presentation: "assistant",
    urgency: "normal",
    idempotency_key: "same",
    thread_anchor_text: null
  };
}
