import type { InternalJobV1, WorkspaceWriteLeaseV1 } from "@second-brain/contracts/schemas";
import type { ColumnType, Generated } from "kysely";

type Timestamp = ColumnType<Date | string, Date | string | undefined, Date | string>;

export interface JobsTable {
  id: string;
  workspace_id: string;
  schema_version: number;
  type: InternalJobV1["type"];
  payload: ColumnType<InternalJobV1["payload"], InternalJobV1["payload"] | string>;
  priority: number;
  status: InternalJobV1["status"];
  attempts: Generated<number>;
  available_at: Timestamp;
  lease_owner: string | null;
  lease_expires_at: ColumnType<Date | string | null, Date | string | null>;
  idempotency_key: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface RootRunAdmissionsTable {
  root_run_id: string;
  root_job_id: string;
  workspace_id: string;
  lease_owner: string;
  acquired_at: Timestamp;
  heartbeat_at: Timestamp;
  expires_at: Timestamp;
  state: "active" | "releasing" | "released";
  terminal_reason: string | null;
  released_at: ColumnType<Date | string | null, Date | string | null>;
}

export interface WorkspaceWriteLeasesTable {
  workspace_id: string;
  id: string;
  owner_run_id: string;
  acquired_at: ColumnType<Date | string, WorkspaceWriteLeaseV1["acquiredAt"]>;
  expires_at: ColumnType<Date | string, WorkspaceWriteLeaseV1["expiresAt"]>;
}
