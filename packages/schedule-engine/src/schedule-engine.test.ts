import { describe, expect, it } from "vitest";

import { nextOccurrence, previewSchedule } from "./index.js";

const now = new Date("2026-07-17T15:00:00.000Z");

describe("schedule engine", () => {
  it("previews a future one-time schedule", () => {
    expect(
      previewSchedule({ type: "once", runAt: "2026-07-17T16:00:00.000Z" }, { now, count: 3 })
    ).toEqual({
      nextRunAt: "2026-07-17T16:00:00.000Z",
      occurrences: ["2026-07-17T16:00:00.000Z"]
    });
  });

  it("returns no occurrence for an expired one-time schedule", () => {
    expect(
      previewSchedule({ type: "once", runAt: "2026-07-17T14:00:00.000Z" }, { now, count: 3 })
    ).toEqual({ occurrences: [] });
  });

  it("previews interval schedules and enforces minimum frequency", () => {
    expect(
      previewSchedule(
        { type: "interval", seconds: 3600, timezone: "Europe/Stockholm" },
        { now, count: 3 }
      ).occurrences
    ).toEqual(["2026-07-17T16:00:00.000Z", "2026-07-17T17:00:00.000Z", "2026-07-17T18:00:00.000Z"]);

    expect(() =>
      previewSchedule(
        { type: "interval", seconds: 30, timezone: "Europe/Stockholm" },
        { now, count: 3 }
      )
    ).toThrow(/at least/);
  });

  it("previews cron schedules in the configured timezone", () => {
    expect(
      previewSchedule(
        { type: "cron", expression: "0 8 * * *", timezone: "Europe/Stockholm" },
        { now, count: 3 }
      ).occurrences
    ).toEqual(["2026-07-18T06:00:00.000Z", "2026-07-19T06:00:00.000Z", "2026-07-20T06:00:00.000Z"]);
  });

  it("rejects invalid timezones and cron expressions", () => {
    expect(() =>
      previewSchedule({ type: "cron", expression: "0 8 * * *", timezone: "Not/AZone" }, { now })
    ).toThrow(/Invalid IANA timezone/);

    expect(() =>
      previewSchedule(
        { type: "cron", expression: "not cron", timezone: "Europe/Stockholm" },
        { now }
      )
    ).toThrow();
  });

  it("returns the next occurrence directly", () => {
    expect(nextOccurrence({ type: "interval", seconds: 3600, timezone: "UTC" }, now)).toBe(
      "2026-07-17T16:00:00.000Z"
    );
  });
});
