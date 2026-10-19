import { describe, expect, it } from "vitest";

import type { SessionRecord } from "@second-brain/domain";

import {
  displayLabel,
  formatSessionList,
  formatStatus,
  formatTimestamp,
  normalizeSessionLabel
} from "./session-presentation.js";

describe("session presentation", () => {
  it("renders stable labels, statuses, timestamps, and an ordered session list", () => {
    const item = session();

    expect(displayLabel({ ...item, label: "  " })).toBe("Untitled conversation");
    expect(formatStatus("closed")).toBe("Closed");
    expect(formatTimestamp(item.lastActiveAt)).toBe("2026-01-01 12:34:56 UTC");
    expect(formatSessionList([item])).toContain(
      "1. Planning · Active · Last activity 2026-01-01 12:34:56 UTC"
    );
    expect(formatSessionList([item])).not.toContain("**");
    expect(normalizeSessionLabel("  one   two three four five six seven eight nine ")).toBe(
      "one two three four five six seven eight…"
    );
  });
});

function session(): SessionRecord {
  const now = new Date("2026-01-01T12:34:56.000Z");
  return {
    id: "session-1",
    label: "Planning",
    status: "active",
    createdAt: now,
    lastActiveAt: now,
    idleExpiresAt: now,
    absoluteExpiresAt: now,
    piSessionKey: "session-1",
    sourceType: "default-room",
    sourceConversationId: "!room:example"
  };
}
