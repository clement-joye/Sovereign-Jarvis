import type { SessionRecord, SessionStatus } from "@second-brain/domain";

export interface SessionRow {
  id: string;
  workspace_id?: string;
  label: string | null;
  status: string;
  created_at: Date | string;
  last_active_at: Date | string;
  idle_expires_at: Date | string;
  absolute_expires_at: Date | string;
  pi_session_key: string;
  source_type: string;
  source_conversation_id: string | null;
  source_thread_root_id: string | null;
  source_schedule_id: string | null;
}

const sessionStatuses = ["active", "idle", "closed", "expired", "purged"] as const;
const sessionSourceTypes = ["default-room", "thread", "scheduled"] as const;

/** Parses a stored session and reports only its key when its shape is invalid. */
export function rowToSession(row: SessionRow): SessionRecord {
  if (!sessionStatuses.includes(row.status as SessionStatus)) {
    throw invalidSessionRow(row.id);
  }
  if (!sessionSourceTypes.includes(row.source_type as SessionRecord["sourceType"])) {
    throw invalidSessionRow(row.id);
  }

  const createdAt = toValidDate(row.created_at, row.id);
  const lastActiveAt = toValidDate(row.last_active_at, row.id);
  const idleExpiresAt = toValidDate(row.idle_expires_at, row.id);
  const absoluteExpiresAt = toValidDate(row.absolute_expires_at, row.id);
  if (!row.id || !row.pi_session_key) {
    throw invalidSessionRow(row.id);
  }

  return {
    id: row.id,
    ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
    ...(row.label ? { label: row.label } : {}),
    status: row.status as SessionStatus,
    createdAt,
    lastActiveAt,
    idleExpiresAt,
    absoluteExpiresAt,
    piSessionKey: row.pi_session_key,
    sourceType: row.source_type as SessionRecord["sourceType"],
    ...(row.source_conversation_id ? { sourceConversationId: row.source_conversation_id } : {}),
    ...(row.source_thread_root_id ? { sourceThreadRootId: row.source_thread_root_id } : {}),
    ...(row.source_schedule_id ? { sourceScheduleId: row.source_schedule_id } : {})
  };
}

function toValidDate(value: Date | string, id: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw invalidSessionRow(id);
  }
  return date;
}

function invalidSessionRow(id: string): Error {
  return new Error(`Invalid persisted session row: ${id || "unknown"}`);
}
