import type { ColumnType } from "kysely";
import type { AgentRunV1, AgentRunNoticeOriginV1 } from "@second-brain/contracts/schemas";

type Timestamp = ColumnType<Date | string, Date | string | undefined, Date | string>;
type NoticeOriginStored = AgentRunNoticeOriginV1 | string | null;
type NoticeOriginColumn = ColumnType<
  AgentRunNoticeOriginV1 | null,
  NoticeOriginStored,
  NoticeOriginStored
>;

export interface AgentRunsTable {
  id: string;
  workspace_id: string;
  agent_id: string;
  catalog_version: string;
  catalog_digest: string;
  effective_policy_digest: string | null;
  platform_policy_digest: string | null;
  resource_digest: string | null;
  runtime_image_id: string | null;
  status: AgentRunV1["status"];
  root_run_id: string;
  parent_run_id: string | null;
  delegation_grant_id: string | null;
  deadline_at: Timestamp;
  timeout_seconds: number;
  token_budget: number | null;
  created_at: Timestamp;
  started_at: ColumnType<Date | string | null, Date | string | null, Date | string | null>;
  completed_at: ColumnType<Date | string | null, Date | string | null, Date | string | null>;
  result_text: string | null;
  notice_origin: NoticeOriginColumn;
}
