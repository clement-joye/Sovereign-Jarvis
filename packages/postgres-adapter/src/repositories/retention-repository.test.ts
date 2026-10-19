import { describe, expect, it } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";

import type { RetentionRecord } from "@second-brain/application/ports/media";

import type { PostgresQueryable } from "../job-queue.js";
import { PostgresRetentionRepository } from "./retention-repository.js";

describe("PostgresRetentionRepository", () => {
  it("derives eligible retention records from authoritative tables", async () => {
    const db = new RecordingDb([
      [
        retentionRow({
          id: "inbound_message:workspace-example:inbound-1",
          target_type: "inbound_message",
          target_id: "inbound-1"
        }),
        retentionRow({
          id: "attachment:workspace-example:attachment-1",
          target_type: "attachment",
          target_id: "attachment-1",
          storage_key: "inbound/attachment-1"
        })
      ]
    ]);
    const repository = new PostgresRetentionRepository({ db, retentionMs: 604_800_000 });

    await expect(
      repository.listEligible({ now: new Date("2026-07-18T12:00:00.000Z"), limit: 20 })
    ).resolves.toMatchObject([
      {
        id: "inbound_message:workspace-example:inbound-1",
        workspaceId: "workspace-example",
        targetType: "inbound_message"
      },
      {
        id: "attachment:workspace-example:attachment-1",
        workspaceId: "workspace-example",
        targetType: "attachment",
        storageKey: "inbound/attachment-1"
      }
    ]);

    expect(db.calls[0]?.sql).toContain("FROM brain_core.inbound_messages");
    expect(db.calls[0]?.sql).toContain("FROM brain_core.attachments");
    expect(db.calls[0]?.sql).toContain("retention_tombstones");
    expect(db.calls[0]?.values).toEqual([
      "2026-07-11T12:00:00.000Z",
      "2026-07-18T12:00:00.000Z",
      20
    ]);
  });

  it("caps configured retention at the hard maximum boundary", async () => {
    const db = new RecordingDb([[]]);
    const repository = new PostgresRetentionRepository({
      db,
      retentionMs: 30 * 86_400_000,
      maxRetentionMs: 10 * 86_400_000
    });

    await repository.listEligible({ now: new Date("2026-07-18T12:00:00.000Z"), limit: 5 });

    expect(db.calls[0]?.values?.[0]).toBe("2026-07-08T12:00:00.000Z");
  });

  it("upserts pending and completed tombstones", async () => {
    const db = new RecordingDb([[], [], []]);
    const repository = new PostgresRetentionRepository({ db, retentionMs: 604_800_000 });
    const record = retentionRecord({ targetType: "attachment", targetId: "attachment-1" });

    await repository.tombstone({
      record,
      now: new Date("2026-07-18T12:00:00.000Z"),
      status: "pending"
    });
    await repository.tombstone({
      record,
      now: new Date("2026-07-18T12:01:00.000Z"),
      status: "completed"
    });

    expect(db.calls[0]?.sql).toContain('insert into "brain_core"."retention_tombstones"');
    expect(db.calls[0]?.sql).toContain('on conflict ("id") do update');
    expect(db.calls[0]?.values?.slice(0, 8)).toEqual([
      "attachment:workspace-example:attachment-1:pending",
      "workspace-example",
      "attachment",
      "attachment-1",
      "pending",
      "expired",
      new Date("2026-07-18T12:00:00.000Z"),
      null
    ]);
    expect(db.calls[1]?.values?.[0]).toBe("attachment:workspace-example:attachment-1:completed");
    expect(db.calls[1]?.values?.[6]).toEqual(new Date("2026-07-18T12:01:00.000Z"));
  });

  it("removes inbound attachment links before clearing inbound content", async () => {
    const db = new RecordingDb([[], []]);
    const repository = new PostgresRetentionRepository({ db, retentionMs: 604_800_000 });

    await repository.sanitize({
      record: retentionRecord({ targetType: "inbound_message", targetId: "inbound-1" }),
      now: new Date("2026-07-18T12:00:00.000Z")
    });

    expect(db.calls[0]?.sql).toContain("DELETE FROM brain_core.inbound_message_attachments");
    expect(db.calls[0]?.values).toEqual(["inbound-1", "workspace-example"]);
    expect(db.calls[1]?.sql).toContain('update "brain_core"."inbound_messages"');
    expect(db.calls[1]?.values).toEqual([null, null, {}, "inbound-1", "workspace-example"]);
  });

  it("removes outbound content links before clearing outbound content", async () => {
    const db = new RecordingDb([[], []]);
    const repository = new PostgresRetentionRepository({ db, retentionMs: 604_800_000 });

    await repository.sanitize({
      record: retentionRecord({ targetType: "outbound_message", targetId: "outbound-1" }),
      now: new Date("2026-07-18T12:00:00.000Z")
    });

    expect(db.calls[0]?.sql).toContain("DELETE FROM brain_core.outbound_message_images");
    expect(db.calls[0]?.values).toEqual(["outbound-1", "workspace-example"]);
    expect(db.calls[1]?.sql).toContain("DELETE FROM brain_core.outbound_message_files");
    expect(db.calls[2]?.sql).toContain('update "brain_core"."outbound_messages"');
    expect(db.calls[2]?.values).toEqual([null, null, "outbound-1", "workspace-example"]);
  });

  it("deletes only unreferenced attachment rows after file deletion succeeds", async () => {
    const db = new RecordingDb([[]]);
    const repository = new PostgresRetentionRepository({ db, retentionMs: 604_800_000 });

    await repository.sanitize({
      record: retentionRecord({ targetType: "attachment", targetId: "attachment-1" }),
      now: new Date("2026-07-18T12:00:00.000Z")
    });

    expect(db.calls[0]?.sql).toContain("DELETE FROM brain_core.attachments");
    expect(db.calls[0]?.sql).toContain("NOT EXISTS");
    expect(db.calls[0]?.values).toEqual(["attachment-1", "workspace-example"]);
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

function retentionRecord(overrides: Partial<RetentionRecord> = {}): RetentionRecord {
  return {
    id: "attachment:workspace-example:attachment-1",
    workspaceId: "workspace-example",
    targetType: "attachment",
    targetId: "attachment-1",
    eligibleAt: new Date("2026-07-11T12:00:00.000Z"),
    reason: "expired",
    ...overrides
  };
}

function retentionRow(overrides: QueryResultRow = {}): QueryResultRow {
  return {
    id: "attachment:workspace-example:attachment-1",
    workspace_id: "workspace-example",
    target_type: "attachment",
    target_id: "attachment-1",
    storage_key: null,
    eligible_at: "2026-07-11T12:00:00.000Z",
    reason: "expired",
    ...overrides
  };
}
