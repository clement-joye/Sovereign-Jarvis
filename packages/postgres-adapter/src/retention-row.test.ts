import { describe, expect, it } from "vitest";

import { rowToRetentionRecord, type RetentionRow } from "./retention-row.js";

describe("rowToRetentionRecord", () => {
  it("maps valid retention rows", () => {
    expect(rowToRetentionRecord(retentionRow())).toMatchObject({
      id: "attachment:workspace-example:attachment-1",
      workspaceId: "workspace-example",
      targetType: "attachment"
    });
  });

  it("rejects invalid target types and timestamps with only the record key", () => {
    expect(() => rowToRetentionRecord(retentionRow({ target_type: "unexpected" }))).toThrow(
      "Invalid persisted retention row: attachment:workspace-example:attachment-1"
    );
    expect(() => rowToRetentionRecord(retentionRow({ eligible_at: "not-a-date" }))).toThrow(
      "Invalid persisted retention row: attachment:workspace-example:attachment-1"
    );
  });
});

function retentionRow(overrides: Partial<RetentionRow> = {}): RetentionRow {
  return {
    id: "attachment:workspace-example:attachment-1",
    workspace_id: "workspace-example",
    target_type: "attachment",
    target_id: "attachment-1",
    storage_key: "inbound/attachment-1",
    eligible_at: "2026-07-11T12:00:00.000Z",
    reason: "expired",
    ...overrides
  };
}
