import type { AttachmentReferenceV1, InboundMessageV1 } from "@second-brain/contracts/schemas";
import { requireWorkspaceId } from "@second-brain/domain";

import { rowToAttachment, type AttachmentRow } from "./attachment-row.js";
import type { PostgresQueryable } from "./postgres-queryable.js";
import { typedDatabase, type TypedPostgresDatabase } from "./typed-database.js";

/** Owns attachment persistence and relationships for inbound messages. */
export class PostgresInboundAttachmentStore {
  private readonly db: TypedPostgresDatabase;

  constructor(queryable: PostgresQueryable) {
    this.db = typedDatabase(queryable);
  }

  async persist(message: InboundMessageV1): Promise<void> {
    for (const attachment of message.attachments) {
      await this.persistAttachment(attachment, message.workspaceId);
      await this.db
        .withSchema("brain_core")
        .insertInto("inbound_message_attachments")
        .values({ inbound_message_id: message.id, attachment_id: attachment.id })
        .onConflict((conflict) =>
          conflict.columns(["inbound_message_id", "attachment_id"]).doNothing()
        )
        .execute();
    }
  }

  async forMessage(
    inboundMessageId: string,
    workspaceId: string
  ): Promise<AttachmentReferenceV1[]> {
    const rows = await this.db
      .withSchema("brain_core")
      .selectFrom("attachments")
      .innerJoin("inbound_message_attachments as links", "links.attachment_id", "attachments.id")
      .innerJoin("inbound_messages as inbound", "inbound.id", "links.inbound_message_id")
      .selectAll("attachments")
      .where("links.inbound_message_id", "=", inboundMessageId)
      .where("inbound.workspace_id", "=", workspaceId)
      .where("attachments.workspace_id", "=", workspaceId)
      .orderBy("attachments.created_at", "asc")
      .orderBy("attachments.id", "asc")
      .execute();
    return rows.map((row) => rowToAttachment(row as AttachmentRow));
  }

  private async persistAttachment(
    attachment: AttachmentReferenceV1,
    workspaceId?: string
  ): Promise<void> {
    await this.db
      .withSchema("brain_core")
      .insertInto("attachments")
      .values(attachmentValues(attachment, workspaceId))
      .onConflict((conflict) => conflict.column("id").doNothing())
      .execute();
  }
}

function attachmentValues(attachment: AttachmentReferenceV1, workspaceId?: string) {
  return {
    id: attachment.id,
    workspace_id: requireWorkspaceId(
      attachment.workspaceId ?? workspaceId,
      "Inbound attachment persistence"
    ),
    schema_version: attachment.schemaVersion,
    purpose: attachment.purpose,
    media_type: attachment.mediaType,
    size_bytes: attachment.sizeBytes,
    sha256: attachment.sha256,
    storage_key: attachment.storageKey,
    original_filename: attachment.originalFilename ?? null,
    duration_ms: attachment.durationMs ?? null,
    width: attachment.width ?? null,
    height: attachment.height ?? null
  };
}
