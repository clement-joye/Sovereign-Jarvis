import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { AttachmentReferenceV1 } from "@second-brain/contracts";

import { FfmpegAudioNormalizer, NodeProcessRunner, type ProcessRunner } from "../index.js";
import type { InvalidMediaError, SttUnavailableError } from "../index.js";

const execFileAsync = promisify(execFile);
const ffmpegAvailable = existsSync("/usr/bin/ffmpeg") && existsSync("/usr/bin/ffprobe");

describe("FfmpegAudioNormalizer", () => {
  it("verifies the source, uses fixed commands, and cleans its private directory", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "normalizer-unit-"));
    const source = Buffer.from("trusted source bytes");
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner: ProcessRunner = {
      async run(input) {
        calls.push({ command: input.command, args: input.args });
        if (input.command === "ffprobe") {
          return {
            exitCode: 0,
            stdout: '{"format":{"duration":"1.25"}}',
            stderr: "",
            timedOut: false
          };
        }
        await writeFile(input.args.at(-1) ?? "", Buffer.from("wav bytes"));
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
      }
    };
    const normalizer = new FfmpegAudioNormalizer({
      attachments: { open: async () => source },
      runner,
      tempRoot,
      ffprobeBinary: "ffprobe",
      ffmpegBinary: "ffmpeg"
    });

    const normalized = await normalizer.normalize(attachment(source));

    expect(normalized.durationMs).toBe(1250);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.command).toBe("ffprobe");
    expect(calls[0]?.args.slice(0, -1)).toEqual([
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "json"
    ]);
    expect(calls[1]?.args).toEqual([
      "-nostdin",
      "-v",
      "error",
      "-i",
      expect.stringMatching(/\/input$/),
      "-map",
      "0:a:0",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      expect.stringMatching(/\/normalized\.wav$/)
    ]);
    await expect(stat(normalized.path)).resolves.toMatchObject({ size: 9 });
    await normalized.cleanup();
    await expect(stat(normalized.path)).rejects.toMatchObject({ code: "ENOENT" });
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("rejects source integrity mismatches before running a process", async () => {
    const source = Buffer.from("actual");
    const runner: ProcessRunner = {
      run: async () => {
        throw new Error("must not run");
      }
    };
    const normalizer = new FfmpegAudioNormalizer({
      attachments: { open: async () => source },
      runner
    });

    await expect(
      normalizer.normalize({ ...attachment(source), sha256: "0".repeat(64) })
    ).rejects.toEqual(
      expect.objectContaining<Partial<InvalidMediaError>>({
        code: "audio_hash_mismatch",
        retryable: false
      })
    );
  });

  it("classifies a processing timeout as retryable and removes partial output", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "normalizer-timeout-"));
    const source = Buffer.from("trusted source bytes");
    const runner: ProcessRunner = {
      async run(input) {
        if (input.command === "ffprobe") {
          return {
            exitCode: 0,
            stdout: '{"format":{"duration":"1"}}',
            stderr: "",
            timedOut: false
          };
        }
        await writeFile(input.args.at(-1) ?? "", Buffer.from("partial"));
        return { exitCode: -1, stdout: "", stderr: "", timedOut: true };
      }
    };
    const normalizer = new FfmpegAudioNormalizer({
      attachments: { open: async () => source },
      runner,
      tempRoot,
      ffprobeBinary: "ffprobe",
      ffmpegBinary: "ffmpeg"
    });

    await expect(normalizer.normalize(attachment(source))).rejects.toEqual(
      expect.objectContaining<Partial<SttUnavailableError>>({
        code: "audio_processing_timeout",
        retryable: true
      })
    );
    expect(await directoryEntries(tempRoot)).toEqual([]);
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("rejects an actual over-duration file before normalising it", async () => {
    const source = Buffer.from("trusted source bytes");
    const runner: ProcessRunner = {
      async run(input) {
        expect(input.command).toBe("ffprobe");
        return { exitCode: 0, stdout: '{"format":{"duration":"2"}}', stderr: "", timedOut: false };
      }
    };
    const normalizer = new FfmpegAudioNormalizer({
      attachments: { open: async () => source },
      runner,
      ffprobeBinary: "ffprobe",
      limits: {
        maxAudioDurationMs: 1,
        maxAudioBytes: 1024,
        maxImageBytes: 1,
        maxImagePixels: 1,
        maxTtsCharacters: 1
      }
    });

    await expect(
      normalizer.normalize({ ...attachment(source), durationMs: undefined })
    ).rejects.toEqual(
      expect.objectContaining<Partial<InvalidMediaError>>({
        code: "audio_duration_exceeded",
        retryable: false
      })
    );
  });

  it("classifies decoder failures as terminal and cleans temporary files", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "normalizer-corrupt-"));
    const source = Buffer.from("corrupt bytes");
    const runner: ProcessRunner = {
      async run(input) {
        if (input.command === "ffprobe") {
          return {
            exitCode: 0,
            stdout: '{"format":{"duration":"1"}}',
            stderr: "",
            timedOut: false
          };
        }
        return { exitCode: 1, stdout: "", stderr: "invalid data", timedOut: false };
      }
    };
    const normalizer = new FfmpegAudioNormalizer({
      attachments: { open: async () => source },
      runner,
      tempRoot,
      ffprobeBinary: "ffprobe",
      ffmpegBinary: "ffmpeg"
    });

    await expect(normalizer.normalize(attachment(source))).rejects.toEqual(
      expect.objectContaining<Partial<InvalidMediaError>>({
        code: "audio_normalization_failed",
        retryable: false
      })
    );
    expect(await directoryEntries(tempRoot)).toEqual([]);
    await rm(tempRoot, { recursive: true, force: true });
  });

  it.skipIf(!ffmpegAvailable)("normalises a real Ogg/Opus fixture to mono 16 kHz WAV", async () => {
    const root = await mkdtemp(join(tmpdir(), "normalizer-integration-"));
    const sourcePath = join(root, "source.ogg");
    await execFileAsync("/usr/bin/ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "0.2",
      "-c:a",
      "libopus",
      sourcePath
    ]);
    const source = await readFile(sourcePath);
    const normalizer = new FfmpegAudioNormalizer({
      attachments: { open: async () => source },
      runner: new NodeProcessRunner(),
      tempRoot: root,
      ffprobeBinary: "/usr/bin/ffprobe",
      ffmpegBinary: "/usr/bin/ffmpeg"
    });

    const normalized = await normalizer.normalize(attachment(source));
    const { stdout } = await execFileAsync("/usr/bin/ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_name,sample_rate,channels",
      "-of",
      "json",
      normalized.path
    ]);

    expect(JSON.parse(stdout)).toMatchObject({
      streams: [{ codec_name: "pcm_s16le", sample_rate: "16000", channels: 1 }]
    });
    await normalized.cleanup();
    await rm(root, { recursive: true, force: true });
  });
});

async function directoryEntries(path: string): Promise<string[]> {
  try {
    await access(path);
    return (await import("node:fs/promises")).readdir(path);
  } catch {
    return [];
  }
}

function attachment(source: Uint8Array): AttachmentReferenceV1 {
  return {
    schemaVersion: 1,
    id: "audio-1",
    purpose: "inbound",
    mediaType: "audio/ogg",
    sizeBytes: source.byteLength,
    sha256: createHash("sha256").update(source).digest("hex"),
    storageKey: "inbound/audio-1.ogg",
    durationMs: 2_000
  };
}
