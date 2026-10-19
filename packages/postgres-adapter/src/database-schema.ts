import type { ColumnType, Generated } from "kysely";
import type {
  AgentArtifactV1,
  AttachmentReferenceV1,
  InboundMessageV1,
  OutboundMessageV1,
  ScheduledExecutionV1,
  ScheduledJobV1,
  StructuredErrorV1
} from "@second-brain/contracts/schemas";
import type {
  RoomAgentId,
  SessionRecord,
  WorkspaceRecord,
  WorkspaceRoomBindingRecord
} from "@second-brain/domain";

import type {
  ActionProposalsTable,
  DeliveryAttemptsTable
} from "./action-proposal-database-schema.js";
import type {
  JobsTable,
  RootRunAdmissionsTable,
  WorkspaceWriteLeasesTable
} from "./operational-database-schema.js";
import type { RetentionTombstonesTable } from "./retention-database-schema.js";
import type { AgentRunsTable } from "./agent-run-database-schema.js";

export type { RetentionTombstonesTable } from "./retention-database-schema.js";

export type JsonObject = Record<string, unknown>;
export type Timestamp = ColumnType<Date | string, Date | string | undefined, Date | string>;

export interface ConversationPreferencesTable {
  workspace_id: string;
  conversation_id: string;
  thread_root_external_event_id: string | null;
  voice_replies_enabled: Generated<boolean>;
  session_context_mode: "persistent" | null;
  session_history_limit: number | null;
  updated_at: Timestamp;
}

export interface WorkspacePluginBindingsTable {
  workspace_id: string;
  plugin_id: string;
  plugin_version: string;
  enabled_agents: string[];
  configuration: ColumnType<JsonObject, JsonObject | string, JsonObject | string>;
  credential_ref: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface WorkspacesTable {
  id: string;
  template_id: string;
  template_version: string;
  configuration: ColumnType<JsonObject, JsonObject | string, JsonObject | string>;
  default_agent: RoomAgentId;
  status: WorkspaceRecord["status"];
  origin: WorkspaceRecord["origin"];
  created_at: Timestamp;
  updated_at: Timestamp;
  activated_at: ColumnType<Date | string | null, Date | string | null, Date | string | null>;
  archived_at: ColumnType<Date | string | null, Date | string | null, Date | string | null>;
  closed_at: ColumnType<Date | string | null, Date | string | null, Date | string | null>;
}

export interface WorkspaceRoomBindingsTable {
  id: string;
  workspace_id: string;
  room_id: string;
  status: WorkspaceRoomBindingRecord["status"];
  created_at: Timestamp;
  archived_at: ColumnType<Date | string | null, Date | string | null, Date | string | null>;
}

export interface ThreadAgentSelectionsTable {
  workspace_id: string;
  conversation_id: string;
  thread_root_external_event_id: string;
  agent_id: RoomAgentId;
  updated_at: Timestamp;
}

export type { AgentRunsTable } from "./agent-run-database-schema.js";

export interface DelegationGrantsTable {
  id: string;
  parent_run_id: string;
  workspace_id: string;
  child_agent_id: string;
  allowed_tools: string[];
  readable_paths: string[];
  writable_paths: string[];
  timeout_seconds: number;
  token_budget: number | null;
  expires_at: Timestamp;
}

export interface AgentArtifactsTable {
  id: string;
  workspace_id: string;
  producing_run_id: string;
  parent_run_id: string | null;
  agent_id: string;
  catalog_version: string;
  catalog_digest: string;
  kind: AgentArtifactV1["kind"];
  storage_key: string;
  sha256: string;
  created_at: Timestamp;
}

export interface AttachmentsTable {
  id: string;
  workspace_id: string;
  schema_version: number;
  purpose: AttachmentReferenceV1["purpose"];
  media_type: string;
  size_bytes: ColumnType<number | string, number, number>;
  sha256: string;
  storage_key: string;
  original_filename: string | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  created_at: Timestamp;
}

export interface InboundMessagesTable {
  id: string;
  workspace_id: string;
  schema_version: number;
  trace_id: string;
  transport: InboundMessageV1["transport"];
  external_event_id: string;
  conversation_id: string;
  agent_id: string;
  sender_id: string;
  received_at: Timestamp;
  kind: InboundMessageV1["kind"];
  text_content: string | null;
  audio_transcript: string | null;
  reply_to_external_event_id: string | null;
  thread_root_external_event_id: string | null;
  replaces_external_event_id: string | null;
  metadata: ColumnType<JsonObject, JsonObject | string, JsonObject | string>;
  created_at: Timestamp;
}

export interface InboundMessageAttachmentsTable {
  inbound_message_id: string;
  attachment_id: string;
}

export interface OutboundMessagesTable {
  id: string;
  workspace_id: string;
  schema_version: number;
  trace_id: string;
  conversation_id: string;
  text_content: string | null;
  audio_attachment_id: string | null;
  reply_to_external_event_id: string | null;
  thread_root_external_event_id: string | null;
  presentation: OutboundMessageV1["presentation"];
  urgency: OutboundMessageV1["urgency"];
  status: Generated<string>;
  idempotency_key: string;
  thread_anchor_text: string | null;
  created_at: Timestamp;
  delivered_at: ColumnType<Date | string | null, Date | string | null, Date | string | null>;
}

export interface OutboundMessageAttachmentLinksTable {
  outbound_message_id: string;
  attachment_id: string;
}

export interface SessionsTable {
  id: string;
  workspace_id: string;
  label: string | null;
  status: SessionRecord["status"];
  created_at: Timestamp;
  last_active_at: Timestamp;
  idle_expires_at: Timestamp;
  absolute_expires_at: Timestamp;
  pi_session_key: string;
  source_type: SessionRecord["sourceType"];
  source_conversation_id: string | null;
  source_thread_root_id: string | null;
  source_schedule_id: string | null;
  version: Generated<number>;
}

export interface SessionBindingsTable {
  id: string;
  workspace_id: string;
  agent_id: RoomAgentId;
  conversation_id: string | null;
  thread_root_external_event_id: string | null;
  schedule_id: string | null;
  active_session_id: string;
  version: Generated<number>;
  updated_at: Timestamp;
}

export interface ScheduledJobsTable {
  id: string;
  workspace_id: string;
  destination_conversation_id: string | null;
  destination_thread_root_external_event_id: string | null;
  agent_id: string;
  schema_version: number;
  name: string;
  instruction: string;
  schedule: ColumnType<
    unknown,
    ScheduledJobV1["schedule"] | string,
    ScheduledJobV1["schedule"] | string
  >;
  enabled: boolean;
  session_policy: ColumnType<
    unknown,
    ScheduledJobV1["sessionPolicy"] | string,
    ScheduledJobV1["sessionPolicy"] | string
  >;
  notification_policy: ScheduledJobV1["notificationPolicy"];
  overlap_policy: ScheduledJobV1["overlapPolicy"];
  missed_run_policy: ScheduledJobV1["missedRunPolicy"];
  timeout_seconds: ColumnType<number | string, number, number>;
  next_run_at: ColumnType<Date | string | null, Date | string | null, Date | string | null>;
  last_run_at: ColumnType<Date | string | null, Date | string | null, Date | string | null>;
  version: ColumnType<number | string, number, number>;
  deleted_at: ColumnType<Date | string | null, Date | string | null, Date | string | null>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ScheduledExecutionsTable {
  id: string;
  workspace_id: string;
  schema_version: number;
  schedule_id: string;
  scheduled_for: Timestamp;
  status: ScheduledExecutionV1["status"];
  attempt: ColumnType<number | string, number, number>;
  session_id: string | null;
  result_fingerprint: string | null;
  error: ColumnType<
    StructuredErrorV1 | null,
    StructuredErrorV1 | string | null,
    StructuredErrorV1 | string | null
  >;
  created_at: Timestamp;
  started_at: ColumnType<Date | string | null, Date | string | null, Date | string | null>;
  finished_at: ColumnType<Date | string | null, Date | string | null, Date | string | null>;
}

export interface ActionApprovalPoliciesTable {
  workspace_id: string;
  plugin_id: string;
  operation_id: string;
  mode: "owner";
  updated_at: Timestamp;
}

/**
 * Tables available to typed repository queries.
 *
 * Add tables here as repositories migrate. The SQL migrations remain the
 * authoritative schema history; this interface is the compile-time view used
 * by Kysely.
 */
export interface JarvisDatabase {
  action_approval_policies: ActionApprovalPoliciesTable;
  action_proposals: ActionProposalsTable;
  agent_artifacts: AgentArtifactsTable;
  agent_runs: AgentRunsTable;
  attachments: AttachmentsTable;
  conversation_preferences: ConversationPreferencesTable;
  delegation_grants: DelegationGrantsTable;
  delivery_attempts: DeliveryAttemptsTable;
  inbound_message_attachments: InboundMessageAttachmentsTable;
  inbound_messages: InboundMessagesTable;
  jobs: JobsTable;
  outbound_message_files: OutboundMessageAttachmentLinksTable;
  outbound_message_images: OutboundMessageAttachmentLinksTable;
  outbound_messages: OutboundMessagesTable;
  retention_tombstones: RetentionTombstonesTable;
  root_run_admissions: RootRunAdmissionsTable;
  scheduled_executions: ScheduledExecutionsTable;
  scheduled_jobs: ScheduledJobsTable;
  session_bindings: SessionBindingsTable;
  sessions: SessionsTable;
  thread_agent_selections: ThreadAgentSelectionsTable;
  workspace_plugin_bindings: WorkspacePluginBindingsTable;
  workspace_room_bindings: WorkspaceRoomBindingsTable;
  workspace_write_leases: WorkspaceWriteLeasesTable;
  workspaces: WorkspacesTable;
}
