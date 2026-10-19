import { describe, expect, it } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";

import { exampleOutboundMessage } from "@second-brain/contracts/examples";

import { PostgresOutboundCompletionService, type PostgresTransactionalClient } from "./index.js";

describe("PostgresOutboundCompletionService", () => {
  it("commits outbound creation and job completion in one transaction", async () => {
    const client = new RecordingClient([[], [outboundRow()], [], [], []], [0, 1, 0, 0, 1]);
    const service = new PostgresOutboundCompletionService({
      db: { connect: async () => client }
    });

    await expect(
      service.createOutboundAndComplete({
        outbound: exampleOutboundMessage,
        jobId: "job-1",
        leaseOwner: "worker-1"
      })
    ).resolves.toMatchObject({ id: "outbound-1" });

    expect(client.commands()).toEqual(["BEGIN", "COMMIT"]);
    expect(client.sql()).toContain('insert into "brain_core"."outbound_messages"');
    expect(client.sql()).toContain("UPDATE brain_jobs.jobs");
    expect(client.released).toBe(true);
  });

  it("reuses duplicate outbound records before completing the job", async () => {
    const client = new RecordingClient(
      [[], [], [outboundRow({ id: "outbound-original" })], [], [], []],
      [0, 0, 1, 0, 0, 1]
    );
    const service = new PostgresOutboundCompletionService({
      db: { connect: async () => client }
    });

    await expect(
      service.createOutboundAndComplete({
        outbound: exampleOutboundMessage,
        jobId: "job-1",
        leaseOwner: "worker-1"
      })
    ).resolves.toMatchObject({ id: "outbound-original" });

    expect(client.sql()).toContain('where "workspace_id" = $1');
    expect(client.sql()).toContain('and "idempotency_key" = $2');
    expect(client.commands()).toEqual(["BEGIN", "COMMIT"]);
  });

  it("rolls back if job completion fails", async () => {
    const client = new RecordingClient([[], [outboundRow()], [], []], [0, 1, 0], 4);
    const service = new PostgresOutboundCompletionService({
      db: { connect: async () => client }
    });

    await expect(
      service.createOutboundAndComplete({
        outbound: exampleOutboundMessage,
        jobId: "job-1",
        leaseOwner: "worker-1"
      })
    ).rejects.toThrow(/forced query failure/);

    expect(client.commands()).toEqual(["BEGIN", "ROLLBACK"]);
    expect(client.released).toBe(true);
  });
});

class RecordingClient implements PostgresTransactionalClient {
  readonly calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
  released = false;
  private resultIndex = 0;

  constructor(
    private readonly rows: QueryResultRow[][],
    private readonly rowCounts: number[] = [],
    private readonly failAt?: number
  ) {}

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<T>> {
    this.calls.push(values ? { sql: text, values } : { sql: text });
    if (this.failAt !== undefined && this.calls.length === this.failAt) {
      throw new Error("forced query failure");
    }
    const rows = (this.rows[this.resultIndex] ?? []) as T[];
    this.resultIndex += 1;
    return {
      command: "SELECT",
      oid: 0,
      fields: [],
      rows,
      rowCount: this.rowCounts[this.resultIndex - 1] ?? rows.length
    };
  }

  release(): void {
    this.released = true;
  }

  commands(): string[] {
    return this.calls
      .map((call) => call.sql.trim())
      .filter((sql) => sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK");
  }

  sql(): string {
    return this.calls.map((call) => call.sql).join("\n");
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
