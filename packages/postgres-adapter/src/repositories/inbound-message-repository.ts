import type { InboundMessageRepositoryPort } from "@second-brain/application/ports/sessions";
import type { InboundMessageV1, ThreadHistoryItemV1 } from "@second-brain/contracts/schemas";
import { InboundMessageV1Schema } from "@second-brain/contracts/schemas";
import { requireWorkspaceId } from "@second-brain/domain";
import { sql } from "kysely";

import { PostgresInboundAttachmentStore } from "../postgres-inbound-attachment-store.js";
import type { PostgresQueryable } from "../postgres-queryable.js";
import { typedDatabase, type TypedPostgresDatabase } from "../typed-database.js";

export interface PostgresInboundMessageRepositoryOptions {
  db: PostgresQueryable;
}

export class PostgresInboundMessageRepository implements InboundMessageRepositoryPort {
  private readonly db: TypedPostgresDatabase;
  private readonly attachments: PostgresInboundAttachmentStore;

  constructor(options: PostgresInboundMessageRepositoryOptions) {
    this.db = typedDatabase(options.db);
    this.attachments = new PostgresInboundAttachmentStore(options.db);
  }

  async create(
    message: InboundMessageV1
  ): Promise<
    { message: InboundMessageV1; duplicate: false } | { message: InboundMessageV1; duplicate: true }
  > {
    const inserted = await this.db
      .withSchema("brain_core")
      .insertInto("inbound_messages")
      .values(inboundValues(message))
      .onConflict((conflict) => conflict.columns(["transport", "external_event_id"]).doNothing())
      .returningAll()
      .executeTakeFirst();

    if (inserted) {
      await this.attachments.persist(message);
      return { message, duplicate: false };
    }

    const existing = await this.getByTransportEvent({
      transport: message.transport,
      externalEventId: message.externalEventId
    });
    if (!existing) {
      throw new Error(`Inbound duplicate index returned no row: ${message.externalEventId}`);
    }
    return { message: existing, duplicate: true };
  }

  async get(id: string): Promise<InboundMessageV1 | undefined> {
    const row = await inboundQuery(this.db).where("id", "=", id).executeTakeFirst();
    return row ? this.rowToInbound(row) : undefined;
  }

  async getByTransportEvent(input: {
    transport: InboundMessageV1["transport"];
    externalEventId: string;
  }): Promise<InboundMessageV1 | undefined> {
    const row = await inboundQuery(this.db)
      .where("transport", "=", input.transport)
      .where("external_event_id", "=", input.externalEventId)
      .executeTakeFirst();
    return row ? this.rowToInbound(row) : undefined;
  }

  async saveAudioTranscript(input: {
    id: string;
    workspaceId: string;
    text: string;
  }): Promise<void> {
    const row = await this.db
      .withSchema("brain_core")
      .updateTable("inbound_messages")
      .set({ audio_transcript: input.text })
      .where("id", "=", input.id)
      .where("workspace_id", "=", input.workspaceId)
      .where("kind", "=", "audio")
      .returning("id")
      .executeTakeFirst();
    if (!row) throw new Error("Audio message was not found in the requested workspace.");
  }

  async listThreadHistory(input: {
    message: InboundMessageV1;
    limit: number;
  }): Promise<ThreadHistoryItemV1[]> {
    const rootEventId = input.message.threadRootExternalEventId ?? input.message.externalEventId;
    const workspaceId = requireWorkspaceId(input.message.workspaceId, "Inbound thread history");
    const core = this.db.withSchema("brain_core");
    const messages = core
      .selectFrom("inbound_messages")
      .select([
        sql<"user" | "jarvis">`'user'`.as("sender"),
        sql<string>`concat_ws(E'\\n', text_content, case when audio_transcript is not null then '[Voice transcript] ' || audio_transcript end)`.as(
          "text_content"
        ),
        "received_at as occurred_at"
      ])
      .where("workspace_id", "=", workspaceId)
      .where("conversation_id", "=", input.message.conversationId)
      .where(
        sql<string>`coalesce(thread_root_external_event_id, external_event_id)`,
        "=",
        rootEventId
      )
      .where("id", "!=", input.message.id)
      .where("kind", "!=", "command")
      .where(sql<boolean>`text_content is not null or audio_transcript is not null`)
      .unionAll(
        core
          .selectFrom("outbound_messages")
          .select([
            sql<"user" | "jarvis">`'jarvis'`.as("sender"),
            sql<string>`text_content`.as("text_content"),
            "created_at as occurred_at"
          ])
          .where("workspace_id", "=", workspaceId)
          .where("conversation_id", "=", input.message.conversationId)
          .where("thread_root_external_event_id", "=", rootEventId)
          .where("presentation", "=", "assistant")
          .where("text_content", "is not", null)
          .where(
            "idempotency_key",
            "not in",
            core
              .selectFrom("inbound_messages")
              .select(sql<string>`'process_inbound:' || id || ':outbound'`.as("idempotency_key"))
              .where("kind", "=", "command")
          )
      );
    const rows = await this.db
      .selectFrom(messages.as("thread_messages"))
      .selectAll()
      .orderBy("occurred_at", "desc")
      .limit(Math.max(1, Math.min(input.limit, 100)))
      .execute();
    return rows.reverse().map((row) => ({
      sender: row.sender === "jarvis" ? "jarvis" : "user",
      text: row.text_content,
      occurredAt: toIso(row.occurred_at)
    }));
  }

  async snapshot(): Promise<InboundMessageV1[]> {
    const rows = await inboundQuery(this.db)
      .orderBy("received_at", "asc")
      .orderBy("id", "asc")
      .execute();
    return Promise.all(rows.map((row) => this.rowToInbound(row)));
  }

  private async rowToInbound(row: InboundMessageRow): Promise<InboundMessageV1> {
    const attachments = await this.attachments.forMessage(row.id, row.workspace_id);
    return InboundMessageV1Schema.parse({
      schemaVersion: row.schema_version,
      id: row.id,
      traceId: row.trace_id,
      transport: row.transport,
      externalEventId: row.external_event_id,
      conversationId: row.conversation_id,
      workspaceId: row.workspace_id,
      agentId: row.agent_id,
      senderId: row.sender_id,
      receivedAt: toIso(row.received_at),
      kind: row.kind,
      ...(row.text_content ? { text: row.text_content } : {}),
      attachments,
      ...(row.reply_to_external_event_id
        ? { replyToExternalEventId: row.reply_to_external_event_id }
        : {}),
      ...(row.thread_root_external_event_id
        ? { threadRootExternalEventId: row.thread_root_external_event_id }
        : {}),
      ...(row.replaces_external_event_id
        ? { replacesExternalEventId: row.replaces_external_event_id }
        : {}),
      metadata: row.metadata,
      ...(storedUserTimezone(row.metadata)
        ? { userTimezone: storedUserTimezone(row.metadata) }
        : {})
    });
  }
}

interface InboundMessageRow {
  id: string;
  schema_version: number;
  trace_id: string;
  transport: string;
  external_event_id: string;
  conversation_id: string;
  workspace_id: string;
  agent_id: string;
  sender_id: string;
  received_at: Date | string;
  kind: string;
  text_content: string | null;
  reply_to_external_event_id: string | null;
  thread_root_external_event_id: string | null;
  replaces_external_event_id: string | null;
  metadata: unknown;
}

function inboundValues(message: InboundMessageV1) {
  return {
    id: message.id,
    schema_version: message.schemaVersion,
    trace_id: message.traceId,
    transport: message.transport,
    external_event_id: message.externalEventId,
    conversation_id: message.conversationId,
    workspace_id: requireWorkspaceId(message.workspaceId, "Inbound message persistence"),
    agent_id: message.agentId ?? "brain",
    sender_id: message.senderId,
    received_at: message.receivedAt,
    kind: message.kind,
    text_content: message.text ?? null,
    reply_to_external_event_id: message.replyToExternalEventId ?? null,
    thread_root_external_event_id: message.threadRootExternalEventId ?? null,
    replaces_external_event_id: message.replacesExternalEventId ?? null,
    metadata: {
      ...message.metadata,
      ...(message.userTimezone ? { "org.second-brain.user_timezone": message.userTimezone } : {})
    }
  };
}

function inboundQuery(db: TypedPostgresDatabase) {
  return db.withSchema("brain_core").selectFrom("inbound_messages").selectAll();
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function storedUserTimezone(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const value = (metadata as Record<string, unknown>)["org.second-brain.user_timezone"];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
