import { describe, expect, it } from "vitest";

import { TerminalWorkerError } from "@second-brain/application";

import { HttpResponseError } from "./http/http-response-error.js";
import { mapMediaWorkerError } from "./media-worker-error.js";

describe("mapMediaWorkerError", () => {
  it("turns media validation responses into terminal worker errors", () => {
    const mapped = mapMediaWorkerError(
      new HttpResponseError("POST", "/v1/media/transcriptions", 422, '{"error":"invalid_media"}')
    );

    expect(mapped).toBeInstanceOf(TerminalWorkerError);
  });

  it("keeps dependency failures retryable", () => {
    const error = new HttpResponseError(
      "POST",
      "/v1/media/transcriptions",
      503,
      '{"error":"stt_unavailable"}'
    );

    expect(mapMediaWorkerError(error)).toBe(error);
  });
});
