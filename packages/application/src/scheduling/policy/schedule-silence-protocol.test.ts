import { describe, expect, it } from "vitest";

import type { PiRunResultV1 } from "@second-brain/contracts";

import {
  buildScheduleInputText,
  isScheduledSilenceResponse,
  SCHEDULE_SILENCE_TOKEN
} from "./schedule-silence-protocol.js";

describe("buildScheduleInputText", () => {
  it("appends the silence protocol after the schedule's instruction", () => {
    const text = buildScheduleInputText("Summarize the day.");

    expect(text).toBe(["Summarize the day.", "", SCHEDULE_SILENCE_PROTOCOL_BODY].join("\n"));
  });

  it("trims surrounding whitespace from the schedule instruction", () => {
    const text = buildScheduleInputText("  \n  Summarize the day.  \n");

    expect(text.startsWith("Summarize the day.")).toBe(true);
  });

  it("emits only the protocol when the schedule instruction is empty", () => {
    expect(buildScheduleInputText("")).toBe(SCHEDULE_SILENCE_PROTOCOL_BODY);
    expect(buildScheduleInputText("   \n  ")).toBe(SCHEDULE_SILENCE_PROTOCOL_BODY);
  });

  it("includes the sentinel token verbatim in the protocol", () => {
    const text = buildScheduleInputText("Anything.");

    expect(text).toContain(SCHEDULE_SILENCE_TOKEN);
  });
});

describe("isScheduledSilenceResponse", () => {
  it.each([
    [{ status: "completed", text: "  " }],
    [{ status: "completed", text: undefined }],
    [{ status: "completed", text: "" }],
    [{ status: "completed", text: "  <NO_REPLY>  " }],
    [{ status: "completed", text: "<NO_REPLY>" }],
    [{ status: "completed", text: "<NO_REPLY>\n" }]
  ] as const)("returns true for silence result %o", (overrides) => {
    expect(isScheduledSilenceResponse(result(overrides))).toBe(true);
  });

  it.each([
    [{ status: "completed", text: "All clear today." }],
    [{ status: "completed", text: "Today I noticed <NO_REPLY> in the logs." }],
    [{ status: "completed", text: "<NO_REPLY> done." }],
    [{ status: "cancelled", text: undefined }],
    [{ status: "timed_out", text: "" }],
    [{ status: "failed", text: "  " }]
  ] as const)("returns false for non-silence result %o", (overrides) => {
    expect(isScheduledSilenceResponse(result(overrides))).toBe(false);
  });
});

const SCHEDULE_SILENCE_PROTOCOL_BODY = [
  "---",
  "SILENCE PROTOCOL:",
  `If, according to the user's instructions, you should remain silent for this run, reply with EXACTLY the token ${SCHEDULE_SILENCE_TOKEN} and nothing else. Otherwise, respond normally.`,
  "Otherwise, respond normally."
].join("\n");

function result(overrides: Partial<PiRunResultV1> = {}): PiRunResultV1 {
  return {
    schemaVersion: 1,
    id: "run-1",
    traceId: "trace-1",
    sessionId: "session-1",
    status: "completed",
    generatedFiles: [],
    startedAt: "2026-07-27T10:00:00.000Z",
    finishedAt: "2026-07-27T10:00:01.000Z",
    ...overrides
  };
}
