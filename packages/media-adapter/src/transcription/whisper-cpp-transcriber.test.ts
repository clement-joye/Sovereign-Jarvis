import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { AttachmentReferenceV1 } from "@second-brain/contracts";

import {
  WhisperCppTranscriber,
  type AudioNormalizer,
  type ProcessRunner,
  type TranscriptionCache
} from "../index.js";
import type { InvalidMediaError, SttUnavailableError } from "../index.js";

describe("WhisperCppTranscriber", () => {
  it("uses fixed whisper.cpp arguments, parses the pinned JSON shape, and caches the result", async () => {
    const cache = new MemoryCache();
    const calls: Array<{ command: string; args: string[] }> = [];
    const normalizer = fakeNormalizer();
    const runner: ProcessRunner = {
      async run(input) {
        calls.push({ command: input.command, args: input.args });
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
      }
    };
    const transcriber = new WhisperCppTranscriber({
      normalizer,
      runner,
      cache,
      binary: "/usr/local/bin/whisper-cli",
      modelPath: "/opt/models/ggml-small.bin",
      modelVersion: "whisper.cpp-v1:model-small-sha",
      language: "auto",
      readOutput: async () =>
        JSON.stringify({
          result: { language: "sv" },
          transcription: [{ text: " Hej" }, { text: " världen " }]
        })
    });

    await expect(transcriber.transcribeAudio(attachment())).resolves.toMatchObject({
      text: "Hej  världen",
      language: "sv",
      warnings: []
    });
    expect(calls).toEqual([
      {
        command: "/usr/local/bin/whisper-cli",
        args: [
          "-m",
          "/opt/models/ggml-small.bin",
          "-f",
          "/tmp/normalized.wav",
          "-l",
          "auto",
          "-oj",
          "-of",
          "/tmp/transcript",
          "-np",
          "-ng"
        ]
      }
    ]);

    await transcriber.transcribeAudio(attachment());
    expect(calls).toHaveLength(1);
    expect(normalizer.cleanups).toBe(2);
  });

  it("rejects invalid whisper.cpp output without storing it", async () => {
    const cache = new MemoryCache();
    const transcriber = new WhisperCppTranscriber({
      normalizer: fakeNormalizer(),
      runner: successfulRunner(),
      cache,
      binary: "whisper-cli",
      modelPath: "model.bin",
      modelVersion: "v1",
      readOutput: async () => "not json"
    });

    await expect(transcriber.transcribeAudio(attachment())).rejects.toEqual(
      expect.objectContaining<Partial<SttUnavailableError>>({
        code: "stt_invalid_output",
        retryable: true
      })
    );
    expect(cache.values).toHaveLength(0);
  });

  it("includes bounded whisper.cpp stderr when the CLI fails", async () => {
    const transcriber = new WhisperCppTranscriber({
      normalizer: fakeNormalizer(),
      runner: {
        run: async () => ({
          exitCode: 2,
          stdout: "",
          stderr: "error: unsupported option -ng",
          timedOut: false
        })
      },
      cache: new MemoryCache(),
      binary: "whisper-cli",
      modelPath: "model.bin",
      modelVersion: "v1"
    });

    await expect(transcriber.transcribeAudio(attachment())).rejects.toMatchObject({
      code: "stt_unavailable",
      message: "whisper.cpp exited with code 2: error: unsupported option -ng"
    });
  });

  it("treats an empty transcript as terminal media input", async () => {
    const transcriber = new WhisperCppTranscriber({
      normalizer: fakeNormalizer(),
      runner: successfulRunner(),
      cache: new MemoryCache(),
      binary: "whisper-cli",
      modelPath: "model.bin",
      modelVersion: "v1",
      readOutput: async () => JSON.stringify({ result: {}, transcription: [] })
    });

    await expect(transcriber.transcribeAudio(attachment())).rejects.toEqual(
      expect.objectContaining<Partial<InvalidMediaError>>({
        code: "empty_transcript",
        retryable: false
      })
    );
  });

  it("bounds concurrent whisper processes", async () => {
    let release: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transcriber = new WhisperCppTranscriber({
      normalizer: fakeNormalizer(),
      runner: {
        async run() {
          await started;
          return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
        }
      },
      cache: new MemoryCache(),
      binary: "whisper-cli",
      modelPath: "model.bin",
      modelVersion: "v1",
      readOutput: async () => JSON.stringify({ result: {}, transcription: [{ text: "ok" }] })
    });

    const first = transcriber.transcribeAudio(attachment());
    await Promise.resolve();
    await expect(transcriber.transcribeAudio(attachment())).rejects.toEqual(
      expect.objectContaining<Partial<SttUnavailableError>>({
        code: "stt_capacity_exhausted",
        retryable: true
      })
    );
    release?.();
    await expect(first).resolves.toMatchObject({ text: "ok" });
  });
});

class MemoryCache implements TranscriptionCache {
  readonly values: Array<[string, { text: string; warnings: string[]; cacheKey: string }]> = [];

  async get(cacheKey: string) {
    return this.values.find(([key]) => key === cacheKey)?.[1];
  }

  async put(cacheKey: string, result: { text: string; warnings: string[]; cacheKey: string }) {
    this.values.push([cacheKey, result]);
  }
}

function fakeNormalizer(): AudioNormalizer & { cleanups: number } {
  const normalizer = {
    cleanups: 0,
    async normalize() {
      return {
        path: "/tmp/normalized.wav",
        durationMs: 1000,
        sourceSha256: "a".repeat(64),
        cleanup: async () => {
          normalizer.cleanups += 1;
        }
      };
    }
  };
  return normalizer;
}

function successfulRunner(): ProcessRunner {
  return { run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }) };
}

function attachment(): AttachmentReferenceV1 {
  const bytes = Buffer.from("audio");
  return {
    schemaVersion: 1,
    id: "audio-1",
    purpose: "inbound",
    mediaType: "audio/ogg",
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    storageKey: "inbound/audio-1.ogg"
  };
}
