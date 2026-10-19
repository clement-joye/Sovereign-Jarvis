import {
  exampleAttachment,
  exampleInboundMessage,
  exampleOutboundMessage,
  exampleScheduledJob,
  type AttachmentReferenceV1,
  type InboundMessageV1,
  type OutboundMessageV1
} from "@second-brain/contracts";
import {
  PostgresInboundMessageRepository,
  PostgresOutboundRepository,
  PostgresRetentionRepository,
  PostgresScheduleRepository
} from "@second-brain/postgres-adapter";
import type { Pool, QueryResultRow } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  resetDatabase,
  startPostgresIntegrationHarness,
  type PostgresIntegrationHarness
} from "./harness.js";

const now = new Date("2026-07-18T12:00:00.000Z");
const oldIso = "2026-07-10T12:00:00.000Z";
const recentIso = "2026-07-17T12:00:00.000Z";
const sevenDaysMs = 7 * 86_400_000;

describe("PostgreSQL retention integration", () => {
  let harness: PostgresIntegrationHarness;
  let pool: Pool;

  beforeAll(async () => {
    harness = await startPostgresIntegrationHarness();
    pool = harness.pool;
  }, 120_000);

  beforeEach(async () => {
    await resetDatabase(pool);
    await pool.query(
      `INSERT INTO brain_core.workspaces (
         id, template_id, template_version, configuration, status, origin, created_at, updated_at
       ) VALUES (
         'workspace-example', 'second-brain', '1.0.0', '{}', 'active', 'matrix_invite', now(), now()
       ) ON CONFLICT (id) DO NOTHING`
    );
  });

  afterAll(async () => {
    await harness?.stop();
  });

  it("lists old short-lived rows while preserving recently linked attachments and schedules", async () => {
    await inboundMessages().create(inbound("old-inbound", { receivedAt: oldIso }));
    await inboundMessages().create(
      inbound("recent-inbound", {
        receivedAt: recentIso,
        attachments: [attachment("recent-linked-attachment")]
      })
    );
    await setAttachmentCreatedAt("recent-linked-attachment", oldIso);
    await outboundMessages().create(outbound("old-outbound"));
    await markOutboundDelivered("old-outbound", oldIso);
    await schedules().create({ ...exampleScheduledJob, id: "durable-schedule" });

    const eligible = await retention().listEligible({ now, limit: 20 });

    expect(eligible.map((record) => record.id)).toEqual([
      "inbound_message:workspace-example:old-inbound",
      "outbound_message:workspace-example:old-outbound"
    ]);
    await expect(schedules().get("durable-schedule")).resolves.toMatchObject({
      id: "durable-schedule"
    });
  });

  it("sanitizes inbound text, metadata, and attachment links without deleting the attachment row", async () => {
    await inboundMessages().create(
      inbound("old-inbound", {
        receivedAt: oldIso,
        metadata: { source: "matrix" },
        attachments: [attachment("linked-attachment")]
      })
    );

    await retention().sanitize({
      record: retentionRecord("inbound_message", "old-inbound"),
      now
    });

    const inboundRow = await getOne<{
      text_content: string | null;
      metadata: Record<string, unknown>;
    }>("SELECT text_content, metadata FROM brain_core.inbound_messages WHERE id = $1", [
      "old-inbound"
    ]);
    const links = await pool.query(
      "SELECT * FROM brain_core.inbound_message_attachments WHERE inbound_message_id = $1",
      ["old-inbound"]
    );
    const attachmentRow = await getOne<{ id: string }>(
      "SELECT id FROM brain_core.attachments WHERE id = $1",
      ["linked-attachment"]
    );

    expect(inboundRow).toEqual({ text_content: null, metadata: {} });
    expect(links.rowCount).toBe(0);
    expect(attachmentRow.id).toBe("linked-attachment");
  });

  it("deletes unreferenced old attachments but preserves referenced attachments", async () => {
    await inboundMessages().create(
      inbound("recent-inbound", {
        receivedAt: recentIso,
        attachments: [attachment("referenced-attachment")]
      })
    );
    await insertAttachment(attachment("unreferenced-attachment"));

    await retention().sanitize({
      record: retentionRecord("attachment", "unreferenced-attachment"),
      now
    });
    await retention().sanitize({
      record: retentionRecord("attachment", "referenced-attachment"),
      now
    });

    await expect(attachmentExists("unreferenced-attachment")).resolves.toBe(false);
    await expect(attachmentExists("referenced-attachment")).resolves.toBe(true);
  });

  it("sanitizes outbound text, audio references, and image links", async () => {
    await outboundMessages().create(
      outbound("old-outbound", {
        audio: attachment("audio-attachment", {
          mediaType: "audio/ogg",
          originalFilename: "response.ogg"
        }),
        images: [attachment("image-attachment")]
      })
    );

    await retention().sanitize({
      record: retentionRecord("outbound_message", "old-outbound"),
      now
    });

    const outboundRow = await getOne<{
      text_content: string | null;
      audio_attachment_id: string | null;
    }>("SELECT text_content, audio_attachment_id FROM brain_core.outbound_messages WHERE id = $1", [
      "old-outbound"
    ]);
    const links = await pool.query(
      "SELECT * FROM brain_core.outbound_message_images WHERE outbound_message_id = $1",
      ["old-outbound"]
    );

    expect(outboundRow).toEqual({ text_content: null, audio_attachment_id: null });
    expect(links.rowCount).toBe(0);
  });

  it("uses completed tombstones to prevent repeated retention work", async () => {
    const repository = retention();
    await inboundMessages().create(inbound("old-inbound", { receivedAt: oldIso }));
    const record = retentionRecord("inbound_message", "old-inbound");

    await expect(repository.listEligible({ now, limit: 20 })).resolves.toMatchObject([
      { id: "inbound_message:workspace-example:old-inbound" }
    ]);
    await repository.tombstone({ record, now, status: "completed" });

    await expect(repository.listEligible({ now, limit: 20 })).resolves.toEqual([]);
  });

  function inboundMessages(): PostgresInboundMessageRepository {
    return new PostgresInboundMessageRepository({ db: pool });
  }

  function outboundMessages(): PostgresOutboundRepository {
    return new PostgresOutboundRepository({ db: pool });
  }

  function schedules(): PostgresScheduleRepository {
    return new PostgresScheduleRepository({ db: pool });
  }

  function retention(): PostgresRetentionRepository {
    return new PostgresRetentionRepository({ db: pool, retentionMs: sevenDaysMs });
  }

  async function setAttachmentCreatedAt(id: string, createdAt: string): Promise<void> {
    await pool.query(
      "UPDATE brain_core.attachments SET created_at = $2::timestamptz WHERE id = $1",
      [id, createdAt]
    );
  }

  async function markOutboundDelivered(id: string, createdAt: string): Promise<void> {
    await pool.query(
      `
        UPDATE brain_core.outbound_messages
        SET status = 'delivered',
            created_at = $2::timestamptz,
            delivered_at = $2::timestamptz
        WHERE id = $1
      `,
      [id, createdAt]
    );
  }

  async function insertAttachment(reference: AttachmentReferenceV1): Promise<void> {
    await pool.query(
      `
        INSERT INTO brain_core.attachments (
          id,
          schema_version,
          purpose,
          media_type,
          size_bytes,
          sha256,
          storage_key,
          original_filename,
          workspace_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        reference.id,
        reference.schemaVersion,
        reference.purpose,
        reference.mediaType,
        reference.sizeBytes,
        reference.sha256,
        reference.storageKey,
        reference.originalFilename ?? null,
        reference.workspaceId
      ]
    );
  }

  async function attachmentExists(id: string): Promise<boolean> {
    const result = await pool.query("SELECT 1 FROM brain_core.attachments WHERE id = $1", [id]);
    return result.rowCount === 1;
  }

  async function getOne<T extends QueryResultRow>(sql: string, values: unknown[]): Promise<T> {
    const result = await pool.query<T>(sql, values);
    const row = result.rows[0];
    if (!row) {
      throw new Error(`Expected one row for query: ${sql}`);
    }
    return row;
  }
});

function inbound(id: string, overrides: Partial<InboundMessageV1> = {}): InboundMessageV1 {
  return {
    ...exampleInboundMessage,
    id,
    traceId: `trace-${id}`,
    externalEventId: `$${id}`,
    text: `message ${id}`,
    receivedAt: recentIso,
    attachments: [],
    metadata: {},
    ...overrides
  };
}

function outbound(id: string, overrides: Partial<OutboundMessageV1> = {}): OutboundMessageV1 {
  return {
    ...exampleOutboundMessage,
    id,
    traceId: `trace-${id}`,
    idempotencyKey: `outbound:${id}`,
    text: `response ${id}`,
    images: [],
    ...overrides
  };
}

function attachment(
  id: string,
  overrides: Partial<AttachmentReferenceV1> = {}
): AttachmentReferenceV1 {
  return {
    ...exampleAttachment,
    id,
    purpose: "outbound",
    storageKey: `attachments/${id}`,
    originalFilename: `${id}.bin`,
    ...overrides
  };
}

function retentionRecord(
  targetType: "inbound_message" | "attachment" | "outbound_message",
  id: string
) {
  return {
    id: `${targetType}:workspace-example:${id}`,
    workspaceId: "workspace-example",
    targetType,
    targetId: id,
    eligibleAt: new Date(oldIso),
    reason: "integration_test"
  };
}
