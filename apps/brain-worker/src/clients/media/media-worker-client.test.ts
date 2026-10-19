import { afterEach, describe, expect, it, vi } from "vitest";

import { exampleAttachment } from "@second-brain/contracts";

import { HttpMediaProcessor } from "./media-worker-client.js";

describe("HttpMediaProcessor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates Media Worker transcription responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ text: "Hello", language: "en" }))
    );

    await expect(
      new HttpMediaProcessor("http://media.test").transcribeAudio(exampleAttachment)
    ).resolves.toEqual({ text: "Hello", language: "en" });
  });

  it("rejects malformed Media Worker speech responses", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ audio: {} })));

    await expect(
      new HttpMediaProcessor("http://media.test").synthesizeAudio("Hello")
    ).rejects.toThrow();
  });

  it("passes the configured media timeout to requests", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ text: "Hello", language: "en" }));
    vi.stubGlobal("fetch", fetchMock);

    await new HttpMediaProcessor("http://media.test", 1000).transcribeAudio(exampleAttachment);

    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}
