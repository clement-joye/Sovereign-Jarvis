import { once } from "node:events";

import { describe, expect, it } from "vitest";

import {
  MediaSpeechResponseV1Schema,
  MediaTranscriptionResponseV1Schema,
  type AttachmentReferenceV1
} from "@second-brain/contracts";
import { InvalidMediaError, SttUnavailableError } from "@second-brain/media-adapter";
import { createStructuredLogger, type StructuredLogger } from "@second-brain/observability";

import { createMediaServer, type MediaHttpProcessor } from "./media-server.js";

describe("media-worker HTTP server", () => {
  it("reports aggregated dependency readiness in the health envelope", async () => {
    await withServer(
      processor(),
      {
        provider: "whisper-cpp",
        ready: false,
        availableSlots: 0,
        modelVersion: "v1.8.6:ggml-small"
      },
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/health`);

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toMatchObject({
          schemaVersion: 1,
          service: "media-worker",
          status: "unavailable",
          dependencies: [
            { name: "stt:whisper-cpp", status: "unavailable" },
            { name: "tts:piper", status: "ready" }
          ]
        });
      }
    );
  });

  it("reports selected STT readiness without host paths", async () => {
    await withServer(
      processor(),
      {
        provider: "whisper-cpp",
        ready: true,
        availableSlots: 1,
        modelVersion: "v1.8.6:ggml-small"
      },
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/health`);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
          schemaVersion: 1,
          service: "media-worker",
          status: "ready",
          version: "0.0.0",
          dependencies: [
            { name: "stt:whisper-cpp", status: "ready" },
            { name: "tts:piper", status: "ready" }
          ],
          stt: {
            provider: "whisper-cpp",
            ready: true,
            availableSlots: 1,
            modelVersion: "v1.8.6:ggml-small"
          },
          tts: { provider: "piper", ready: true, modelVersion: "v1.0.0:en_US-lessac-medium" }
        });
      }
    );
  });

  it("returns 200, 422, and 503 for the media transcription contract", async () => {
    const attachment = reference();
    await withServer(processor(), { provider: "deterministic", ready: true }, async (baseUrl) => {
      const response = await post(baseUrl, attachment);
      expect(response.status).toBe(200);
      const body: unknown = await response.json();
      expect(body).toEqual({ text: "hello", language: "en" });
      expect(MediaTranscriptionResponseV1Schema.parse(body)).toEqual(body);
    });
    const invalidLogger = captureLogger();
    await withServer(
      processor({ error: new InvalidMediaError("Corrupt audio.") }),
      { provider: "deterministic", ready: true },
      async (baseUrl) => {
        const response = await post(baseUrl, attachment);
        expect(response.status).toBe(422);
        await expect(response.json()).resolves.toEqual({ error: "invalid_media" });
      },
      invalidLogger.logger
    );
    expect(invalidLogger.events.at(-1)).toMatchObject({
      level: "error",
      message: "media request failed",
      data: { error_code: "invalid_media", cause: "Corrupt audio." }
    });
    const unavailableLogger = captureLogger();
    await withServer(
      processor({ error: new SttUnavailableError() }),
      { provider: "whisper-cpp", ready: false },
      async (baseUrl) => {
        const response = await post(baseUrl, attachment);
        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({ error: "stt_unavailable" });
      },
      unavailableLogger.logger
    );
    expect(unavailableLogger.events.at(-1)).toMatchObject({
      level: "error",
      message: "media request failed",
      data: { error_code: "stt_unavailable" }
    });
  });

  it("rejects speech requests without text through the extracted route handler", async () => {
    await withServer(processor(), { provider: "deterministic", ready: true }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/media/speech`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voiceId: "voice-1" })
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "text_required" });
    });
  });

  it("rejects transcription requests with an invalid attachment before invoking the processor", async () => {
    await withServer(processor(), { provider: "deterministic", ready: true }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/media/transcriptions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "" })
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: "invalid_attachment"
      });
    });
  });

  it("forwards a validated attachment to the image prepare processor", async () => {
    const image = imageReference();
    await withServer(processor(), { provider: "deterministic", ready: true }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/media/images/prepare`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(image)
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ id: "image-1" });
    });
  });

  it("rejects image prepare requests with an invalid attachment before invoking the processor", async () => {
    await withServer(processor(), { provider: "deterministic", ready: true }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/media/images/prepare`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "" })
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: "invalid_attachment"
      });
    });
  });

  it("forwards speech text and optional voiceId to the synthesizer", async () => {
    const capture = captureSynthesizer();
    await withServer(
      capture.processor,
      { provider: "deterministic", ready: true },
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/media/speech`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "hello", voiceId: "voice-2" })
        });

        expect(response.status).toBe(200);
        const body: unknown = await response.json();
        expect(body).toEqual({ audio: { ...reference(), purpose: "outbound" } });
        expect(MediaSpeechResponseV1Schema.parse(body)).toEqual(body);
        expect(capture.calls).toEqual([{ text: "hello", voiceId: "voice-2" }]);
      }
    );
  });

  it("returns 404 for unknown routes without invoking the processor", async () => {
    await withServer(processor(), { provider: "deterministic", ready: true }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/unknown`);
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "not_found" });
    });
  });
});

function processor(input: { error?: Error } = {}): MediaHttpProcessor {
  return {
    async transcribeAudio() {
      if (input.error !== undefined) {
        throw input.error;
      }
      return { text: "hello", language: "en", warnings: [], cacheKey: "transcription:key" };
    },
    async prepareImage(attachment) {
      return attachment;
    },
    async synthesizeAudio() {
      return { audio: { ...reference(), purpose: "outbound" }, cacheKey: "tts:key" };
    }
  };
}

interface CapturedLog {
  level: string;
  message: string;
  data: unknown;
}

interface CapturedLogger {
  logger: StructuredLogger;
  events: CapturedLog[];
}

function captureLogger(): CapturedLogger {
  const events: CapturedLog[] = [];
  const logger = createStructuredLogger({
    service: "media-worker-test",
    environment: "test",
    version: "test",
    write: (level, line) => {
      const parsed = JSON.parse(line) as { message: string; data?: unknown };
      events.push({ level, message: parsed.message, data: parsed.data });
    }
  });
  return { logger, events };
}

async function withServer(
  processor: MediaHttpProcessor,
  stt: { provider: string; ready: boolean; availableSlots?: number; modelVersion?: string },
  test: (baseUrl: string) => Promise<void>,
  logger: StructuredLogger = captureLogger().logger
): Promise<void> {
  const server = createMediaServer({
    processor,
    stt,
    tts: { provider: "piper", ready: true, modelVersion: "v1.0.0:en_US-lessac-medium" },
    logger
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected TCP media-worker test server.");
  }
  try {
    await test(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

async function post(baseUrl: string, attachment: AttachmentReferenceV1): Promise<Response> {
  return fetch(`${baseUrl}/v1/media/transcriptions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(attachment)
  });
}

function reference(): AttachmentReferenceV1 {
  return {
    schemaVersion: 1,
    id: "audio-1",
    purpose: "inbound",
    mediaType: "audio/ogg",
    sizeBytes: 5,
    sha256: "a".repeat(64),
    storageKey: "inbound/audio-1.ogg"
  };
}

function imageReference(): AttachmentReferenceV1 {
  return {
    schemaVersion: 1,
    id: "image-1",
    purpose: "inbound",
    mediaType: "image/png",
    sizeBytes: 5,
    sha256: "b".repeat(64),
    storageKey: "inbound/image-1.png"
  };
}

function captureSynthesizer(): {
  processor: MediaHttpProcessor;
  calls: Array<{ text: string; voiceId?: string }>;
} {
  const calls: Array<{ text: string; voiceId?: string }> = [];
  return {
    processor: {
      async transcribeAudio() {
        return { text: "hello", language: "en" };
      },
      async prepareImage(attachment) {
        return attachment;
      },
      async synthesizeAudio(input) {
        calls.push(input);
        return { audio: { ...reference(), purpose: "outbound" }, cacheKey: "tts:key" };
      }
    },
    calls
  };
}
