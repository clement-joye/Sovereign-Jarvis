import { describe, expect, it } from "vitest";

import { InvalidMediaError, SttUnavailableError } from "@second-brain/media-adapter";

import { mediaErrorResponse } from "./media-error-response.js";

describe("mediaErrorResponse", () => {
  it("returns 422 for terminal media errors", () => {
    expect(mediaErrorResponse(new InvalidMediaError("Corrupt audio."))).toEqual({
      statusCode: 422,
      body: { error: "invalid_media" }
    });
  });

  it("returns 503 for retryable STT errors", () => {
    expect(mediaErrorResponse(new SttUnavailableError())).toEqual({
      statusCode: 503,
      body: { error: "stt_unavailable" }
    });
  });
});
