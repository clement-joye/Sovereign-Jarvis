import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PiperTtsSynthesizer,
  type PiperTtsSynthesizerOptions,
  type ProcessRunner
} from "./index.js";

describe("PiperTtsSynthesizer", () => {
  it("normalizes text, invokes Piper and ffmpeg, and stores deterministic OGG metadata", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "piper-tts-test-"));
    const calls: Array<{ command: string; args: string[]; stdin?: string | Uint8Array }> = [];
    const writes: Array<{
      bytes: Uint8Array;
      reference: { storageKey: string; mediaType: string };
    }> = [];
    const runner: ProcessRunner = {
      async run(input) {
        calls.push(input);
        if (input.command === "piper") {
          await writeFile(input.args[input.args.indexOf("--output_file") + 1]!, "wav");
        } else {
          await writeFile(input.args.at(-1)!, "ogg audio");
        }
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
      }
    };
    const synthesizer = new PiperTtsSynthesizer({
      attachments: {
        async put(input) {
          writes.push(input);
          return input.reference;
        }
      },
      runner,
      binary: "piper",
      modelPath: "/models/lessac.onnx",
      voiceId: "en_US-lessac-medium",
      version: "piper-v1:lessac-sha",
      ffmpegBinary: "ffmpeg",
      tempRoot
    });

    const result = await synthesizer.synthesizeAudio({ text: "  Hello\n world  ", id: "reply-1" });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      command: "piper",
      args: ["--model", "/models/lessac.onnx", "--output_file", expect.any(String)],
      stdin: "Hello world\n"
    });
    expect(calls[1]).toMatchObject({
      command: "ffmpeg",
      args: [
        "-nostdin",
        "-v",
        "error",
        "-i",
        expect.any(String),
        "-c:a",
        "libopus",
        "-b:a",
        "48k",
        expect.any(String)
      ]
    });
    expect(result).toMatchObject({
      cacheKey: expect.stringMatching(/^tts:/),
      audio: {
        id: "reply-1",
        purpose: "outbound",
        mediaType: "audio/ogg",
        sizeBytes: 9,
        storageKey: expect.stringMatching(/^outbound\/audio\/tts:.+\.ogg$/)
      }
    });
    expect(writes).toHaveLength(1);
    await expect(readFile(calls[1]!.args.at(-1)!)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects empty and overlong text without spawning a process", async () => {
    let calls = 0;
    const synthesizer = new PiperTtsSynthesizer({
      attachments: { put: async ({ reference }) => reference },
      runner: {
        run: async () => {
          calls += 1;
          return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
        }
      },
      binary: "piper",
      modelPath: "model.onnx",
      voiceId: "voice",
      version: "v1",
      ffmpegBinary: "ffmpeg",
      limits: {
        maxImageBytes: 1,
        maxAudioBytes: 1,
        maxAudioDurationMs: 1,
        maxImagePixels: 1,
        maxTtsCharacters: 3
      }
    });

    await expect(synthesizer.synthesizeAudio({ text: " \n " })).rejects.toMatchObject({
      code: "tts_empty_text"
    });
    await expect(synthesizer.synthesizeAudio({ text: "four" })).rejects.toMatchObject({
      code: "tts_text_too_long"
    });
    expect(calls).toBe(0);
  });

  it("reports Piper errors as retryable tts_unavailable errors", async () => {
    const unavailable = (result: {
      exitCode: number;
      stderr: string;
      timedOut?: boolean;
    }): ProcessRunner => ({
      run: async () => ({ stdout: "", timedOut: false, ...result })
    });
    const options: Omit<PiperTtsSynthesizerOptions, "runner"> = {
      attachments: { put: async ({ reference }) => reference },
      binary: "piper",
      modelPath: "model.onnx",
      voiceId: "voice",
      version: "v1",
      ffmpegBinary: "ffmpeg"
    };

    await expect(
      new PiperTtsSynthesizer({
        ...options,
        runner: unavailable({ exitCode: 2, stderr: "bad model" })
      }).synthesizeAudio({ text: "Hello" })
    ).rejects.toMatchObject({
      code: "tts_unavailable",
      retryable: true,
      message: "Piper synthesis failed. (exit code 2). bad model"
    });
    await expect(
      new PiperTtsSynthesizer({
        ...options,
        runner: unavailable({ exitCode: 0, stderr: "", timedOut: true })
      }).synthesizeAudio({ text: "Hello" })
    ).rejects.toMatchObject({
      code: "tts_unavailable",
      retryable: true,
      message: "Piper synthesis failed. (timed out)."
    });
  });

  it("reports ffmpeg errors as retryable tts_unavailable errors", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "piper-tts-test-"));
    const runner: ProcessRunner = {
      async run(input) {
        if (input.command === "piper") {
          await writeFile(input.args[input.args.indexOf("--output_file") + 1]!, "wav");
          return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
        }
        return { exitCode: 1, stdout: "", stderr: "encoder unavailable", timedOut: false };
      }
    };
    const synthesizer = new PiperTtsSynthesizer({
      attachments: { put: async ({ reference }) => reference },
      runner,
      binary: "piper",
      modelPath: "model.onnx",
      voiceId: "voice",
      version: "v1",
      ffmpegBinary: "ffmpeg",
      tempRoot
    });

    await expect(synthesizer.synthesizeAudio({ text: "Hello" })).rejects.toMatchObject({
      code: "tts_unavailable",
      retryable: true,
      message: "Audio encoding failed. (exit code 1). encoder unavailable"
    });
  });
});
