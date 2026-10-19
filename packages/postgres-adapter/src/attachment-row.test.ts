import { describe, expect, it } from "vitest";

import { rowToAttachment, type AttachmentRow } from "./attachment-row.js";

describe("rowToAttachment", () => {
  it("maps a valid persisted attachment through the contract schema", () => {
    expect(rowToAttachment(attachmentRow())).toMatchObject({
      schemaVersion: 1,
      purpose: "inbound",
      durationMs: 250,
      width: 1280,
      height: 720
    });
  });

  it("rejects invalid persisted discriminants without exposing row content", () => {
    expect(() => rowToAttachment(attachmentRow({ purpose: "unexpected" }))).toThrow(
      "Invalid persisted attachment row: attachment-1"
    );
  });
});

function attachmentRow(overrides: Partial<AttachmentRow> = {}): AttachmentRow {
  return {
    id: "attachment-1",
    schema_version: 1,
    purpose: "inbound",
    media_type: "image/jpeg",
    size_bytes: "1024",
    sha256: "0".repeat(64),
    storage_key: "inbound/message-1/attachment-1",
    original_filename: "photo.jpg",
    duration_ms: "250",
    width: "1280",
    height: "720",
    ...overrides
  };
}
