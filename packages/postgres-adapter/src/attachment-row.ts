import type { QueryResultRow } from "pg";

import {
  AttachmentReferenceV1Schema,
  type AttachmentReferenceV1
} from "@second-brain/contracts/schemas";

export interface AttachmentRow extends QueryResultRow {
  id: string;
  workspace_id?: string;
  schema_version: number;
  purpose: string;
  media_type: string;
  size_bytes: number | string;
  sha256: string;
  storage_key: string;
  original_filename: string | null;
  duration_ms: number | string | null;
  width: number | string | null;
  height: number | string | null;
}

/** Parses an attachment row before it can enter the application layer. */
export function rowToAttachment(row: AttachmentRow): AttachmentReferenceV1 {
  const parsed = AttachmentReferenceV1Schema.safeParse({
    schemaVersion: row.schema_version,
    id: row.id,
    ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
    purpose: row.purpose,
    mediaType: row.media_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    storageKey: row.storage_key,
    ...(row.original_filename ? { originalFilename: row.original_filename } : {}),
    ...(row.duration_ms !== null ? { durationMs: Number(row.duration_ms) } : {}),
    ...(row.width !== null ? { width: Number(row.width) } : {}),
    ...(row.height !== null ? { height: Number(row.height) } : {})
  });

  if (!parsed.success) {
    throw new Error(`Invalid persisted attachment row: ${row.id}`);
  }
  return parsed.data;
}
