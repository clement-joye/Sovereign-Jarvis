import type { ColumnType } from "kysely";
import type { RetentionRecord } from "@second-brain/application/ports/media";

type Timestamp = ColumnType<Date | string, Date | string | undefined, Date | string>;

export interface RetentionTombstonesTable {
  id: string;
  workspace_id: string;
  target_type: RetentionRecord["targetType"];
  target_id: string;
  status: "pending" | "completed";
  reason: string;
  created_at: Timestamp;
  completed_at: ColumnType<Date | string | null, Date | string | null, Date | string | null>;
}
