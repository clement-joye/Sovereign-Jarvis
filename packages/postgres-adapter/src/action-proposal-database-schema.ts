import type { ActionProposalV1 } from "@second-brain/contracts/schemas";
import type { ColumnType } from "kysely";

type JsonObject = Record<string, unknown>;
type Timestamp = ColumnType<Date | string, Date | string | undefined, Date | string>;

export interface ActionProposalsTable {
  id: string;
  schema_version: number;
  operation_digest: string;
  workspace_id: string;
  agent_id: string;
  run_id: string;
  plugin_id: string;
  capability_id: string;
  operation_id: string;
  operation_version: string;
  summary: string;
  parameters: ColumnType<JsonObject, JsonObject | string, JsonObject | string>;
  approval_mode: ActionProposalV1["approvalMode"];
  required_approver: ActionProposalV1["requiredApprover"];
  idempotency_key: string;
  status: ActionProposalV1["status"];
  created_at: Timestamp;
  expires_at: Timestamp;
  decided_at: ColumnType<Date | string | null, Date | string | null, Date | string | null>;
  decided_by: string | null;
  decision_workspace_id: string | null;
  decision_owner_id: string | null;
  decision_external_event_id: string | null;
  decision_reason: string | null;
  approval_prompt_outbound_id: string | null;
}

export interface DeliveryAttemptsTable {
  id: string;
  outbound_message_id: string;
  transport: string;
  external_event_id: string | null;
  status: string;
  error: ColumnType<JsonObject | null, JsonObject | string | null, JsonObject | string | null>;
  attempted_at: Timestamp;
  workspace_id: string;
}
