import { describe, expect, it } from "vitest";

import { exampleAttachment, type PiRunResultV1 } from "@second-brain/contracts";

import { generatedFiles, generatedImages, piResultText } from "./pi-result-presentation.js";

describe("Pi result presentation", () => {
  it.each([
    [{ status: "completed", text: "  Response  " }, "Response"],
    [{ status: "completed", text: "   " }, "Pi run completed with no text response."],
    [{ status: "cancelled" }, "Pi run was cancelled."],
    [{ status: "timed_out" }, "Pi run timed out."],
    [{ status: "failed" }, "Pi run failed."]
  ] as const)("formats %o as %s", (overrides, expected) => {
    expect(piResultText(result(overrides))).toBe(expected);
  });

  it("keeps generated non-image files for file delivery", () => {
    const document = { ...exampleAttachment, id: "document-1", mediaType: "application/pdf" };
    expect(generatedFiles(result({ generatedFiles: [exampleAttachment, document] }))).toEqual([
      document
    ]);
  });

  it("keeps only generated image attachments", () => {
    const audio = { ...exampleAttachment, id: "audio-1", mediaType: "audio/ogg" };

    expect(generatedImages(result({ generatedFiles: [exampleAttachment, audio] }))).toEqual([
      exampleAttachment
    ]);
  });
});

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
