import { describe, expect, it } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";

import { PostgresOutboundDeliveryRepository } from "./outbound-delivery.js";
import type { PostgresQueryable } from "./job-queue.js";

describe("PostgresOutboundDeliveryRepository", () => {
  it("claims pending outbound messages and loads canonical payloads", async () => {
    const db = new RecordingDb([[{ id: "outbound-1" }], [outboundRow()], []]);
    const repository = new PostgresOutboundDeliveryRepository({ db });

    await expect(
      repository.claim({ transport: "matrix", now: new Date("2026-07-18T08:00:00.000Z"), limit: 2 })
    ).resolves.toMatchObject([{ id: "outbound-1", text: "Done." }]);

    expect(db.calls[0]?.sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(db.calls[0]?.sql).toContain("SET status = 'delivering'");
    expect(db.calls[0]?.values).toEqual([2]);
  });

  it("records delivered attempts and marks outbound delivered", async () => {
    const db = new RecordingDb([[], []], [1, 1]);
    const repository = new PostgresOutboundDeliveryRepository({ db });

    await expect(
      repository.markDelivered({
        outboundMessageId: "outbound-1",
        transport: "matrix",
        externalEventId: "$event-1",
        now: new Date("2026-07-18T08:00:00.000Z")
      })
    ).resolves.toMatchObject({
      outboundMessageId: "outbound-1",
      status: "delivered",
      externalEventId: "$event-1",
      deliveredAt: "2026-07-18T08:00:00.000Z"
    });

    expect(db.calls[0]?.sql).toContain('insert into "brain_core"."delivery_attempts"');
    expect(db.calls[0]?.sql).toContain(
      '(select "workspace_id" from "brain_core"."outbound_messages" where "id" = $2)'
    );
    expect(db.calls[0]?.values?.slice(2, 7)).toEqual([
      "outbound-1",
      "matrix",
      "$event-1",
      "delivered",
      null
    ]);
    expect(db.calls[1]?.sql).toContain('update "brain_core"."outbound_messages"');
    expect(db.calls[1]?.values).toEqual([
      "delivered",
      new Date("2026-07-18T08:00:00.000Z"),
      "outbound-1"
    ]);
  });

  it("records retry attempts with structured errors", async () => {
    const db = new RecordingDb([[], []], [1, 1]);
    const repository = new PostgresOutboundDeliveryRepository({ db });
    const error = {
      schemaVersion: 1 as const,
      code: "matrix_unavailable",
      category: "dependency" as const,
      message: "Matrix is unavailable.",
      retryable: true
    };

    await expect(
      repository.markRetry({
        outboundMessageId: "outbound-1",
        transport: "matrix",
        now: new Date("2026-07-18T08:00:00.000Z"),
        error
      })
    ).resolves.toMatchObject({ status: "retry_wait", error });

    expect(db.calls[0]?.values?.[5]).toBe("retry_wait");
    expect(db.calls[0]?.values?.[6]).toEqual(error);
    expect(db.calls[1]?.values).toEqual(["retry_wait", "outbound-1"]);
  });

  it("throws when marking delivery for an unknown outbound message", async () => {
    const db = new RecordingDb([[], []], [1, 0]);
    const repository = new PostgresOutboundDeliveryRepository({ db });

    await expect(
      repository.markFailed({
        outboundMessageId: "missing",
        transport: "matrix",
        now: new Date("2026-07-18T08:00:00.000Z"),
        error: {
          schemaVersion: 1,
          code: "unknown",
          category: "internal",
          message: "Missing outbound.",
          retryable: false
        }
      })
    ).rejects.toThrow(/Unknown outbound message/);
  });
});

class RecordingDb implements PostgresQueryable {
  readonly calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
  private resultIndex = 0;

  constructor(
    private readonly rows: QueryResultRow[][],
    private readonly rowCounts: number[] = []
  ) {}

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<T>> {
    this.calls.push(values ? { sql: text, values } : { sql: text });
    const rows = (this.rows[this.resultIndex] ?? []) as T[];
    const rowCount = this.rowCounts[this.resultIndex] ?? rows.length;
    this.resultIndex += 1;
    return {
      command: text.trimStart().split(" ", 1)[0]?.toUpperCase() ?? "SELECT",
      oid: 0,
      fields: [],
      rows,
      rowCount
    };
  }
}

function outboundRow(overrides: QueryResultRow = {}): QueryResultRow {
  return {
    id: "outbound-1",
    schema_version: 1,
    trace_id: "trace-1",
    conversation_id: "!room:example",
    text_content: "Done.",
    audio_attachment_id: null,
    reply_to_external_event_id: null,
    thread_root_external_event_id: null,
    presentation: "assistant",
    urgency: "normal",
    idempotency_key: "outbound:trace-1:done",
    ...overrides
  };
}
