import type { RetentionRecord } from "@second-brain/application/ports/media";

export interface RetentionRow {
  id: string;
  workspace_id: string;
  target_type: string;
  target_id: string;
  storage_key: string | null;
  eligible_at: Date | string;
  reason: string;
}

const retentionTargetTypes = [
  "inbound_message",
  "attachment",
  "pi_session",
  "outbound_message",
  "execution_content"
] as const;

/** Parses a computed retention row before it is used to mutate stored data. */
export function rowToRetentionRecord(row: RetentionRow): RetentionRecord {
  if (
    !retentionTargetTypes.includes(row.target_type as RetentionRecord["targetType"]) ||
    !row.id ||
    !row.workspace_id ||
    !row.target_id ||
    !row.reason
  ) {
    throw invalidRetentionRow(row.id);
  }
  const eligibleAt = row.eligible_at instanceof Date ? row.eligible_at : new Date(row.eligible_at);
  if (Number.isNaN(eligibleAt.getTime())) {
    throw invalidRetentionRow(row.id);
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    targetType: row.target_type as RetentionRecord["targetType"],
    targetId: row.target_id,
    ...(row.storage_key ? { storageKey: row.storage_key } : {}),
    eligibleAt,
    reason: row.reason
  };
}

function invalidRetentionRow(id: string): Error {
  return new Error(`Invalid persisted retention row: ${id || "unknown"}`);
}
