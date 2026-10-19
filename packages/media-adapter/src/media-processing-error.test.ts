import { describe, expect, it } from "vitest";

import {
  InvalidMediaError,
  MissingAttachmentError,
  SttUnavailableError
} from "./media-processing-error.js";

describe("media processing errors", () => {
  it("marks invalid and missing media as terminal", () => {
    expect(new InvalidMediaError("Unsupported type.")).toMatchObject({
      code: "invalid_media",
      retryable: false
    });
    expect(new MissingAttachmentError()).toMatchObject({
      code: "missing_attachment",
      retryable: false
    });
  });

  it("marks an unavailable STT dependency as retryable", () => {
    expect(new SttUnavailableError()).toMatchObject({
      code: "stt_unavailable",
      retryable: true
    });
  });
});
