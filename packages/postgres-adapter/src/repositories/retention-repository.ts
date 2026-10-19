import type {
  RetentionRecord,
  RetentionRepositoryPort
} from "@second-brain/application/ports/media";
import { sql } from "kysely";

import type { PostgresQueryable } from "../postgres-queryable.js";
import { rowToRetentionRecord, type RetentionRow } from "../retention-row.js";
import { typedDatabase, type TypedPostgresDatabase } from "../typed-database.js";

const eligibleRetentionRecordsQuery = `
  SELECT *
  FROM (
    SELECT
      ('inbound_message:' || inbound.workspace_id || ':' || inbound.id) AS id,
      inbound.workspace_id,
      'inbound_message' AS target_type,
      inbound.id AS target_id,
      NULL::text AS storage_key,
      inbound.received_at AS eligible_at,
      'short_term_retention_expired' AS reason
    FROM brain_core.inbound_messages AS inbound
    WHERE inbound.received_at <= $1::timestamptz
      AND NOT EXISTS (
        SELECT 1
        FROM brain_core.retention_tombstones AS tombstone
        WHERE tombstone.target_type = 'inbound_message'
          AND tombstone.workspace_id = inbound.workspace_id
          AND tombstone.target_id = inbound.id
          AND tombstone.status = 'completed'
      )

    UNION ALL

    SELECT
      ('attachment:' || attachment.workspace_id || ':' || attachment.id) AS id,
      attachment.workspace_id,
      'attachment' AS target_type,
      attachment.id AS target_id,
      attachment.storage_key,
      attachment.created_at AS eligible_at,
      'short_term_attachment_expired' AS reason
    FROM brain_core.attachments AS attachment
    WHERE attachment.created_at <= $1::timestamptz
      AND NOT EXISTS (
        SELECT 1
        FROM brain_core.inbound_message_attachments AS inbound_link
        INNER JOIN brain_core.inbound_messages AS inbound
          ON inbound.id = inbound_link.inbound_message_id
        WHERE inbound_link.attachment_id = attachment.id
          AND inbound.received_at > $1::timestamptz
      )
      AND NOT EXISTS (
        SELECT 1
        FROM brain_core.outbound_message_images AS outbound_link
        INNER JOIN brain_core.outbound_messages AS outbound
          ON outbound.id = outbound_link.outbound_message_id
        WHERE outbound_link.attachment_id = attachment.id
          AND outbound.created_at > $1::timestamptz
      )
      AND NOT EXISTS (
        SELECT 1
        FROM brain_core.outbound_message_files AS outbound_link
        INNER JOIN brain_core.outbound_messages AS outbound
          ON outbound.id = outbound_link.outbound_message_id
        WHERE outbound_link.attachment_id = attachment.id
          AND outbound.created_at > $1::timestamptz
      )
      AND NOT EXISTS (
        SELECT 1
        FROM brain_core.outbound_messages AS outbound
        WHERE outbound.audio_attachment_id = attachment.id
          AND outbound.created_at > $1::timestamptz
      )
      AND NOT EXISTS (
        SELECT 1
        FROM brain_core.retention_tombstones AS tombstone
        WHERE tombstone.target_type = 'attachment'
          AND tombstone.workspace_id = attachment.workspace_id
          AND tombstone.target_id = attachment.id
          AND tombstone.status = 'completed'
      )

    UNION ALL

    SELECT
      ('outbound_message:' || outbound.workspace_id || ':' || outbound.id) AS id,
      outbound.workspace_id,
      'outbound_message' AS target_type,
      outbound.id AS target_id,
      NULL::text AS storage_key,
      outbound.created_at AS eligible_at,
      'short_term_outbound_expired' AS reason
    FROM brain_core.outbound_messages AS outbound
    WHERE outbound.created_at <= $1::timestamptz
      AND outbound.status IN ('delivered', 'failed')
      AND NOT EXISTS (
        SELECT 1
        FROM brain_core.retention_tombstones AS tombstone
        WHERE tombstone.target_type = 'outbound_message'
          AND tombstone.workspace_id = outbound.workspace_id
          AND tombstone.target_id = outbound.id
          AND tombstone.status = 'completed'
      )

    UNION ALL

    SELECT
      ('execution_content:' || execution.workspace_id || ':' || execution.id) AS id,
      execution.workspace_id,
      'execution_content' AS target_type,
      execution.id AS target_id,
      NULL::text AS storage_key,
      execution.created_at AS eligible_at,
      'short_term_execution_content_expired' AS reason
    FROM brain_core.scheduled_executions AS execution
    WHERE execution.created_at <= $1::timestamptz
      AND execution.status IN ('succeeded', 'failed', 'timed_out', 'cancelled', 'skipped')
      AND NOT EXISTS (
        SELECT 1
        FROM brain_core.retention_tombstones AS tombstone
        WHERE tombstone.target_type = 'execution_content'
          AND tombstone.workspace_id = execution.workspace_id
          AND tombstone.target_id = execution.id
          AND tombstone.status = 'completed'
      )

    UNION ALL

    SELECT
      ('pi_session:' || session.workspace_id || ':' || session.id) AS id,
      session.workspace_id,
      'pi_session' AS target_type,
      session.id AS target_id,
      NULL::text AS storage_key,
      session.absolute_expires_at AS eligible_at,
      'session_retention_expired' AS reason
    FROM brain_core.sessions AS session
    WHERE session.absolute_expires_at <= $2::timestamptz
      AND NOT EXISTS (
        SELECT 1
        FROM brain_core.retention_tombstones AS tombstone
        WHERE tombstone.target_type = 'pi_session'
          AND tombstone.workspace_id = session.workspace_id
          AND tombstone.target_id = session.id
          AND tombstone.status = 'completed'
      )
  ) AS eligible
  ORDER BY eligible_at ASC, id ASC
  LIMIT $3
`;

export interface PostgresRetentionRepositoryOptions {
  db: PostgresQueryable;
  retentionMs: number;
  maxRetentionMs?: number;
}

export class PostgresRetentionRepository implements RetentionRepositoryPort {
  private readonly db: TypedPostgresDatabase;
  private readonly rawDb: PostgresQueryable;
  private readonly retentionMs: number;

  constructor(options: PostgresRetentionRepositoryOptions) {
    this.db = typedDatabase(options.db);
    this.rawDb = options.db;
    this.retentionMs = Math.min(options.retentionMs, options.maxRetentionMs ?? options.retentionMs);
  }

  async listEligible(input: { now: Date; limit: number }): Promise<RetentionRecord[]> {
    const eligibleBefore = new Date(input.now.getTime() - this.retentionMs).toISOString();
    const result = await this.rawDb.query<RetentionRow>(eligibleRetentionRecordsQuery, [
      eligibleBefore,
      input.now.toISOString(),
      input.limit
    ]);
    return result.rows.map(rowToRetentionRecord);
  }

  async tombstone(input: {
    record: RetentionRecord;
    now: Date;
    status: "pending" | "completed";
  }): Promise<void> {
    await this.db
      .withSchema("brain_core")
      .insertInto("retention_tombstones")
      .values({
        id: tombstoneId(input.record, input.status),
        workspace_id: input.record.workspaceId,
        target_type: input.record.targetType,
        target_id: input.record.targetId,
        status: input.status,
        reason: input.record.reason,
        created_at: input.now,
        completed_at: input.status === "completed" ? input.now : null
      })
      .onConflict((conflict) =>
        conflict.column("id").doUpdateSet({
          status: input.status,
          reason: input.record.reason,
          completed_at: input.status === "completed" ? input.now : null
        })
      )
      .execute();
  }

  async sanitize(input: { record: RetentionRecord; now: Date }): Promise<void> {
    switch (input.record.targetType) {
      case "inbound_message":
        return this.sanitizeInbound(input.record);
      case "attachment":
        return this.sanitizeAttachment(input.record);
      case "outbound_message":
        return this.sanitizeOutbound(input.record);
      case "execution_content":
        return this.clearExecutionError(input.record);
      case "pi_session":
        return this.closeSession(input.record);
    }
  }

  private async sanitizeInbound(record: RetentionRecord): Promise<void> {
    const values = [record.targetId, record.workspaceId];
    await this.rawDb.query(
      `DELETE FROM brain_core.inbound_message_attachments USING brain_core.inbound_messages AS inbound WHERE inbound_message_attachments.inbound_message_id = inbound.id AND inbound_message_attachments.inbound_message_id = $1 AND inbound.workspace_id = $2`,
      values
    );
    await this.db
      .withSchema("brain_core")
      .updateTable("inbound_messages")
      .set({ text_content: null, audio_transcript: null, metadata: {} })
      .where("id", "=", record.targetId)
      .where("workspace_id", "=", record.workspaceId)
      .execute();
  }

  private async sanitizeAttachment(record: RetentionRecord): Promise<void> {
    await this.rawDb.query(
      `DELETE FROM brain_core.attachments WHERE id = $1 AND workspace_id = $2 AND NOT EXISTS (SELECT 1 FROM brain_core.inbound_message_attachments WHERE attachment_id = $1) AND NOT EXISTS (SELECT 1 FROM brain_core.outbound_message_images WHERE attachment_id = $1) AND NOT EXISTS (SELECT 1 FROM brain_core.outbound_message_files WHERE attachment_id = $1) AND NOT EXISTS (SELECT 1 FROM brain_core.outbound_messages WHERE audio_attachment_id = $1)`,
      [record.targetId, record.workspaceId]
    );
  }

  private async sanitizeOutbound(record: RetentionRecord): Promise<void> {
    const values = [record.targetId, record.workspaceId];
    await this.rawDb.query(
      `DELETE FROM brain_core.outbound_message_images USING brain_core.outbound_messages AS outbound WHERE outbound_message_images.outbound_message_id = outbound.id AND outbound_message_images.outbound_message_id = $1 AND outbound.workspace_id = $2`,
      values
    );
    await this.rawDb.query(
      `DELETE FROM brain_core.outbound_message_files USING brain_core.outbound_messages AS outbound WHERE outbound_message_files.outbound_message_id = outbound.id AND outbound_message_files.outbound_message_id = $1 AND outbound.workspace_id = $2`,
      values
    );
    await this.db
      .withSchema("brain_core")
      .updateTable("outbound_messages")
      .set({ text_content: null, audio_attachment_id: null })
      .where("id", "=", record.targetId)
      .where("workspace_id", "=", record.workspaceId)
      .execute();
  }

  private async clearExecutionError(record: RetentionRecord): Promise<void> {
    await this.db
      .withSchema("brain_core")
      .updateTable("scheduled_executions")
      .set({ error: null })
      .where("id", "=", record.targetId)
      .where("workspace_id", "=", record.workspaceId)
      .execute();
  }

  private async closeSession(record: RetentionRecord): Promise<void> {
    await this.db
      .withSchema("brain_core")
      .updateTable("sessions")
      .set({ label: null, status: "closed", version: sql<number>`version + 1` })
      .where("id", "=", record.targetId)
      .where("workspace_id", "=", record.workspaceId)
      .execute();
  }
}

function tombstoneId(record: RetentionRecord, status: "pending" | "completed"): string {
  return `${record.targetType}:${record.workspaceId}:${record.targetId}:${status}`;
}
