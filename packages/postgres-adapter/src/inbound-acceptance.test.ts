import { describe, expect, it } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";

import { exampleInboundMessage } from "@second-brain/contracts/examples";
import type { IdGeneratorPort } from "@second-brain/domain";

import {
  PostgresInboundAcceptanceService,
  type PostgresTransactionalClient
} from "./inbound-acceptance.js";

describe("PostgresInboundAcceptanceService", () => {
  it("commits inbound insert and job enqueue in one transaction", async () => {
    const client = new RecordingClient([[], [inboundRow()], [jobRow()], []]);
    const service = new PostgresInboundAcceptanceService({
      db: { connect: async () => client },
      ids: new FixedIds(),
      now: () => new Date("2026-07-17T15:00:00.000Z")
    });

    await expect(service.acceptMatrixInbound(exampleInboundMessage)).resolves.toEqual({
      inboundMessageId: "inbound-1",
      duplicate: false,
      jobId: "job-1"
    });

    expect(client.commands()).toEqual(["BEGIN", "COMMIT"]);
    expect(client.sql()).toContain('insert into "brain_core"."inbound_messages"');
    expect(client.sql()).toContain('insert into "brain_jobs"."jobs"');
    const jobInsert = client.calls.find((call) =>
      call.sql.includes('insert into "brain_jobs"."jobs"')
    );
    expect(jobInsert?.values?.[4]).toMatchObject({
      inboundMessageId: "inbound-1",
      agentId: "brain"
    });
    expect(client.released).toBe(true);
  });

  it("returns duplicate inbound results while still ensuring the idempotent job exists", async () => {
    const client = new RecordingClient([
      [],
      [],
      [inboundRow({ id: "inbound-original" })],
      [],
      [jobRow({ id: "job-original" })],
      []
    ]);
    const service = new PostgresInboundAcceptanceService({
      db: { connect: async () => client },
      ids: new FixedIds(),
      now: () => new Date("2026-07-17T15:00:00.000Z")
    });

    await expect(service.acceptMatrixInbound(exampleInboundMessage)).resolves.toEqual({
      inboundMessageId: "inbound-original",
      duplicate: true,
      jobId: "job-original"
    });

    expect(client.sql()).toContain('on conflict ("transport", "external_event_id") do nothing');
    expect(client.sql()).toContain('on conflict ("workspace_id", "idempotency_key")');
    expect(client.commands()).toEqual(["BEGIN", "COMMIT"]);
  });

  it("selects a running turn in the same thread before enqueuing /cancel", async () => {
    const client = new RecordingClient([
      [],
      [inboundRow()],
      [{ id: "job-active", status: "leased" }],
      [
        jobRow({
          payload: {
            inboundMessageId: "inbound-1",
            cancelTargetRunId: "job-active",
            cancelTargetNeedsPiCancel: true
          }
        })
      ],
      []
    ]);
    const service = new PostgresInboundAcceptanceService({
      db: { connect: async () => client },
      ids: new FixedIds(),
      now: () => new Date("2026-07-17T15:00:00.000Z")
    });

    await expect(
      service.acceptMatrixInbound({
        ...exampleInboundMessage,
        text: "/cancel",
        threadRootExternalEventId: "$thread"
      })
    ).resolves.toMatchObject({ cancelTargetRunId: "job-active", cancelTargetNeedsPiCancel: true });

    const lookup = client.calls.find((call) =>
      call.sql.includes("JOIN brain_core.inbound_messages")
    );
    expect(lookup?.values).toEqual([
      "workspace-example",
      exampleInboundMessage.conversationId,
      "$thread",
      exampleInboundMessage.id
    ]);
    expect(client.commands()).toEqual(["BEGIN", "COMMIT"]);
  });

  it("rolls back and releases the client when any step fails", async () => {
    const client = new RecordingClient([[], [inboundRow()]], 2);
    const service = new PostgresInboundAcceptanceService({
      db: { connect: async () => client },
      ids: new FixedIds(),
      now: () => new Date("2026-07-17T15:00:00.000Z")
    });

    await expect(service.acceptMatrixInbound(exampleInboundMessage)).rejects.toThrow(
      /forced query failure/
    );
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
      rowCount: rows.length
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

class FixedIds implements IdGeneratorPort {
  nextId(prefix: string): string {
    return `${prefix}-1`;
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

function jobRow(overrides: QueryResultRow = {}): QueryResultRow {
  return {
    id: "job-1",
    workspace_id: "workspace-example",
    schema_version: 1,
    type: "process_inbound",
    payload: {
      inboundMessageId: "inbound-1",
      agentId: "brain",
      transport: "matrix",
      externalEventId: "$matrix-event-1"
    },
    priority: 100,
    status: "pending",
    attempts: 0,
    available_at: "2026-07-17T15:00:00.000Z",
    lease_owner: null,
    lease_expires_at: null,
    idempotency_key: "matrix:$matrix-event-1:process_inbound",
    ...overrides
  };
}
