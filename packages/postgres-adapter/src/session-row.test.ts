import { describe, expect, it } from "vitest";

import { rowToSession, type SessionRow } from "./session-row.js";

describe("rowToSession", () => {
  it("maps valid session statuses, sources, and timestamps", () => {
    expect(rowToSession(sessionRow())).toMatchObject({
      id: "session-1",
      status: "active",
      sourceType: "default-room"
    });
  });

  it("rejects invalid status and timestamps with only the session key", () => {
    expect(() => rowToSession(sessionRow({ status: "unknown" }))).toThrow(
      "Invalid persisted session row: session-1"
    );
    expect(() => rowToSession(sessionRow({ created_at: "not-a-date" }))).toThrow(
      "Invalid persisted session row: session-1"
    );
  });
});

function sessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "session-1",
    label: null,
    status: "active",
    created_at: "2026-07-17T15:00:00.000Z",
    last_active_at: "2026-07-17T15:00:00.000Z",
    idle_expires_at: "2026-07-18T15:00:00.000Z",
    absolute_expires_at: "2026-07-24T15:00:00.000Z",
    pi_session_key: "session-1",
    source_type: "default-room",
    source_conversation_id: "!room:example",
    source_thread_root_id: null,
    source_schedule_id: null,
    ...overrides
  };
}
