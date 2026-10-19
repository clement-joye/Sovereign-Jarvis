import type { OutboundRepositoryPort } from "@second-brain/application/ports/jobs";
import type { OutboundMessageV1 } from "@second-brain/contracts/schemas";
import { OutboundMessageV1Schema } from "@second-brain/contracts/schemas";
import { requireWorkspaceId } from "@second-brain/domain";

import { PostgresOutboundAttachmentStore } from "../postgres-outbound-attachment-store.js";
import type { PostgresQueryable } from "../postgres-queryable.js";
import { typedDatabase, type TypedPostgresDatabase } from "../typed-database.js";

export interface PostgresOutboundRepositoryOptions {
  db: PostgresQueryable;
}

export class PostgresOutboundRepository implements OutboundRepositoryPort {
  private readonly db: TypedPostgresDatabase;
  private readonly attachments: PostgresOutboundAttachmentStore;

  constructor(options: PostgresOutboundRepositoryOptions) {
    this.db = typedDatabase(options.db);
    this.attachments = new PostgresOutboundAttachmentStore(options.db);
  }

  async create(message: OutboundMessageV1): Promise<OutboundMessageV1> {
    await this.attachments.persist(message);

    const row = await this.runCreate(message);
    if (!row) {
      const existing = await this.getByIdempotencyKey(message.idempotencyKey, message.workspaceId);
      if (!existing) {
        throw new Error(`Outbound duplicate index returned no row: ${message.idempotencyKey}`);
      }
      return existing;
    }

    await this.attachments.link(message);

    return this.rowToOutbound(row);
  }

  private async runCreate(message: OutboundMessageV1): Promise<OutboundMessageRow | undefined> {
    return this.db
      .withSchema("brain_core")
      .insertInto("outbound_messages")
      .values({
        id: message.id,
        schema_version: message.schemaVersion,
        trace_id: message.traceId,
        conversation_id: message.conversationId,
        workspace_id: requireWorkspaceId(message.workspaceId, "Outbound message persistence"),
        text_content: message.text ?? null,
        audio_attachment_id: message.audio?.id ?? null,
        reply_to_external_event_id: message.replyToExternalEventId ?? null,
        thread_root_external_event_id: message.threadRootExternalEventId ?? null,
        presentation: message.presentation,
        urgency: message.urgency,
        idempotency_key: message.idempotencyKey,
        thread_anchor_text: message.threadAnchorText ?? null
      })
      .onConflict((conflict) => conflict.columns(["workspace_id", "idempotency_key"]).doNothing())
      .returningAll()
      .executeTakeFirst();
  }

  async get(id: string): Promise<OutboundMessageV1 | undefined> {
    const row = await outboundQuery(this.db).where("id", "=", id).executeTakeFirst();
    return row ? this.rowToOutbound(row) : undefined;
  }

  async getByIdempotencyKey(
    idempotencyKey: string,
    workspaceId?: string
  ): Promise<OutboundMessageV1 | undefined> {
    const row = await outboundQuery(this.db)
      .where("workspace_id", "=", requireWorkspaceId(workspaceId, "Outbound idempotency lookup"))
      .where("idempotency_key", "=", idempotencyKey)
      .executeTakeFirst();
    return row ? this.rowToOutbound(row) : undefined;
  }

  async snapshot(): Promise<OutboundMessageV1[]> {
    const rows = await outboundQuery(this.db)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();
    return Promise.all(rows.map((row) => this.rowToOutbound(row)));
  }

  private async rowToOutbound(row: OutboundMessageRow): Promise<OutboundMessageV1> {
    const { audio, images, files } = await this.attachments.load({
      id: row.id,
      workspaceId: row.workspace_id,
      audioAttachmentId: row.audio_attachment_id
    });
    return OutboundMessageV1Schema.parse({
      schemaVersion: row.schema_version,
      id: row.id,
      traceId: row.trace_id,
      conversationId: row.conversation_id,
      workspaceId: row.workspace_id,
      ...(row.text_content ? { text: row.text_content } : {}),
      ...(audio ? { audio } : {}),
      images,
      ...(files.length > 0 ? { files } : {}),
      ...(row.reply_to_external_event_id
        ? { replyToExternalEventId: row.reply_to_external_event_id }
        : {}),
      ...(row.thread_root_external_event_id
        ? { threadRootExternalEventId: row.thread_root_external_event_id }
        : {}),
      presentation: row.presentation,
      ...(row.thread_anchor_text ? { threadAnchorText: row.thread_anchor_text } : {}),
      urgency: row.urgency,
      idempotencyKey: row.idempotency_key
    });
  }
}

interface OutboundMessageRow {
  id: string;
  schema_version: number;
  trace_id: string;
  conversation_id: string;
  workspace_id: string;
  text_content: string | null;
  audio_attachment_id: string | null;
  reply_to_external_event_id: string | null;
  thread_root_external_event_id: string | null;
  presentation: OutboundMessageV1["presentation"];
  urgency: string;
  idempotency_key: string;
  thread_anchor_text: string | null;
}

function outboundQuery(db: TypedPostgresDatabase) {
  return db.withSchema("brain_core").selectFrom("outbound_messages").selectAll();
}
