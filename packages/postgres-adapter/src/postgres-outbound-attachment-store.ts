import type { AttachmentReferenceV1, OutboundMessageV1 } from "@second-brain/contracts/schemas";
import { requireWorkspaceId } from "@second-brain/domain";

import { rowToAttachment, type AttachmentRow } from "./attachment-row.js";
import type { PostgresQueryable } from "./postgres-queryable.js";
import { typedDatabase, type TypedPostgresDatabase } from "./typed-database.js";

export interface OutboundAttachmentOwner {
  id: string;
  workspaceId: string;
  audioAttachmentId: string | null;
}

export interface OutboundAttachments {
  audio: AttachmentReferenceV1 | undefined;
  images: AttachmentReferenceV1[];
  files: AttachmentReferenceV1[];
}

/** Owns attachment persistence and outbound-to-attachment relationships. */
export class PostgresOutboundAttachmentStore {
  private readonly db: TypedPostgresDatabase;

  constructor(queryable: PostgresQueryable) {
    this.db = typedDatabase(queryable);
  }

  async persist(message: OutboundMessageV1): Promise<void> {
    const attachments = [
      ...(message.audio ? [message.audio] : []),
      ...message.images,
      ...(message.files ?? [])
    ];
    for (const attachment of attachments) {
      await this.persistAttachment(attachment, message.workspaceId);
    }
  }

  async link(message: OutboundMessageV1): Promise<void> {
    await this.linkAttachments(message.id, "outbound_message_images", message.images);
    await this.linkAttachments(message.id, "outbound_message_files", message.files ?? []);
  }

  async load(owner: OutboundAttachmentOwner): Promise<OutboundAttachments> {
    const [audio, images, files] = await Promise.all([
      owner.audioAttachmentId
        ? this.attachmentById(owner.audioAttachmentId, owner.workspaceId)
        : undefined,
      this.linkedAttachments(owner.id, owner.workspaceId, "outbound_message_images"),
      this.linkedAttachments(owner.id, owner.workspaceId, "outbound_message_files")
    ]);
    return { audio, images, files };
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

  private async linkAttachments(
    outboundMessageId: string,
    table: "outbound_message_images" | "outbound_message_files",
    attachments: AttachmentReferenceV1[]
  ): Promise<void> {
    for (const attachment of attachments) {
      await this.db
        .withSchema("brain_core")
        .insertInto(table)
        .values({ outbound_message_id: outboundMessageId, attachment_id: attachment.id })
        .onConflict((conflict) =>
          conflict.columns(["outbound_message_id", "attachment_id"]).doNothing()
        )
        .execute();
    }
  }

  private async attachmentById(
    id: string,
    workspaceId: string
  ): Promise<AttachmentReferenceV1 | undefined> {
    const row = await this.db
      .withSchema("brain_core")
      .selectFrom("attachments")
      .selectAll()
      .where("id", "=", id)
      .where("workspace_id", "=", workspaceId)
      .executeTakeFirst();
    return row ? rowToAttachment(row as AttachmentRow) : undefined;
  }

  private async linkedAttachments(
    outboundMessageId: string,
    workspaceId: string,
    table: "outbound_message_images" | "outbound_message_files"
  ): Promise<AttachmentReferenceV1[]> {
    const rows = await this.db
      .withSchema("brain_core")
      .selectFrom("attachments")
      .innerJoin(`${table} as links`, "links.attachment_id", "attachments.id")
      .innerJoin("outbound_messages as outbounds", "outbounds.id", "links.outbound_message_id")
      .selectAll("attachments")
      .where("links.outbound_message_id", "=", outboundMessageId)
      .where("outbounds.workspace_id", "=", workspaceId)
      .where("attachments.workspace_id", "=", workspaceId)
      .orderBy("attachments.created_at", "asc")
      .orderBy("attachments.id", "asc")
      .execute();
    return rows.map((row) => rowToAttachment(row as AttachmentRow));
  }
}

function attachmentValues(attachment: AttachmentReferenceV1, workspaceId?: string) {
  return {
    id: attachment.id,
    workspace_id: requireWorkspaceId(
      attachment.workspaceId ?? workspaceId,
      "Outbound attachment persistence"
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
