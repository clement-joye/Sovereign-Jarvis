import { createHash } from "node:crypto";
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import type { AttachmentReferenceV1 } from "@second-brain/contracts";

import {
  InvalidMediaError,
  MissingAttachmentError,
  SttUnavailableError
} from "../media-processing-error.js";
import { defaultMediaLimits, type MediaLimits, validateAudioAttachment } from "../index.js";

export interface AttachmentReader {
  open(storageKey: string): Promise<Uint8Array>;
}

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnErrorCode?: string;
}

export interface ProcessRunner {
  run(input: {
    command: string;
    args: string[];
    timeoutMs: number;
    stdin?: string | Uint8Array;
  }): Promise<ProcessResult>;
}

export interface NormalizedAudio {
  path: string;
  durationMs: number;
  sourceSha256: string;
  cleanup(): Promise<void>;
}

export interface FfmpegAudioNormalizerOptions {
  attachments: AttachmentReader;
  runner?: ProcessRunner;
  tempRoot?: string;
  ffprobeBinary?: string;
  ffmpegBinary?: string;
  probeTimeoutMs?: number;
  normalizeTimeoutMs?: number;
  maxNormalizedBytes?: number;
  limits?: MediaLimits;
}

export class FfmpegAudioNormalizer {
  private readonly attachments: AttachmentReader;
  private readonly runner: ProcessRunner;
  private readonly tempRoot: string;
  private readonly ffprobeBinary: string;
  private readonly ffmpegBinary: string;
  private readonly probeTimeoutMs: number;
  private readonly normalizeTimeoutMs: number;
  private readonly maxNormalizedBytes: number;
  private readonly limits: MediaLimits;

  constructor(options: FfmpegAudioNormalizerOptions) {
    this.attachments = options.attachments;
    this.runner = options.runner ?? new NodeProcessRunner();
    this.tempRoot = options.tempRoot ?? tmpdir();
    this.ffprobeBinary = options.ffprobeBinary ?? "/usr/bin/ffprobe";
    this.ffmpegBinary = options.ffmpegBinary ?? "/usr/bin/ffmpeg";
    this.probeTimeoutMs = options.probeTimeoutMs ?? 30_000;
    this.normalizeTimeoutMs = options.normalizeTimeoutMs ?? 30_000;
    this.limits = options.limits ?? defaultMediaLimits;
    this.maxNormalizedBytes = options.maxNormalizedBytes ?? this.limits.maxAudioBytes;
  }

  async normalize(attachment: AttachmentReferenceV1): Promise<NormalizedAudio> {
    try {
      validateAudioAttachment(attachment, this.limits);
    } catch (error) {
      throw new InvalidMediaError(
        error instanceof Error ? error.message : "Audio attachment validation failed."
      );
    }

    const source = await this.readAndVerify(attachment);
    const directory = await mkdtemp(join(this.tempRoot, "second-brain-audio-"));
    const inputPath = join(directory, "input");
    const outputPath = join(directory, "normalized.wav");

    try {
      await chmod(directory, 0o700);
      await writeFile(inputPath, source, { mode: 0o600, flag: "wx" });

      const durationMs = await this.probeDuration(inputPath);
      if (durationMs > this.limits.maxAudioDurationMs) {
        throw new InvalidMediaError("Audio exceeds maximum duration.", "audio_duration_exceeded");
      }

      const normalized = await this.runner.run({
        command: this.ffmpegBinary,
        args: [
          "-nostdin",
          "-v",
          "error",
          "-i",
          inputPath,
          "-map",
          "0:a:0",
          "-vn",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-c:a",
          "pcm_s16le",
          outputPath
        ],
        timeoutMs: this.normalizeTimeoutMs
      });
      this.assertProcessSucceeded(normalized, "audio_normalization_failed");

      const output = await stat(outputPath);
      if (!output.isFile() || output.size === 0) {
        throw new InvalidMediaError(
          "Audio normalisation produced no output.",
          "audio_normalization_empty"
        );
      }
      if (output.size > this.maxNormalizedBytes) {
        throw new InvalidMediaError(
          "Normalised audio exceeds maximum byte size.",
          "audio_normalization_size_exceeded"
        );
      }

      return {
        path: outputPath,
        durationMs,
        sourceSha256: createHash("sha256").update(source).digest("hex"),
        cleanup: async () => rm(directory, { recursive: true, force: true })
      };
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  private async readAndVerify(attachment: AttachmentReferenceV1): Promise<Uint8Array> {
    let bytes: Uint8Array;
    try {
      bytes = await this.attachments.open(attachment.storageKey);
    } catch (error) {
      if (isNotFound(error)) {
        throw new MissingAttachmentError();
      }
      throw error;
    }

    if (bytes.byteLength !== attachment.sizeBytes) {
      throw new InvalidMediaError(
        "Audio size does not match attachment metadata.",
        "audio_size_mismatch"
      );
    }
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== attachment.sha256) {
      throw new InvalidMediaError(
        "Audio checksum does not match attachment metadata.",
        "audio_hash_mismatch"
      );
    }
    return bytes;
  }

  private async probeDuration(inputPath: string): Promise<number> {
    const result = await this.runner.run({
      command: this.ffprobeBinary,
      args: ["-v", "error", "-show_entries", "format=duration", "-of", "json", inputPath],
      timeoutMs: this.probeTimeoutMs
    });
    this.assertProcessSucceeded(result, "audio_probe_failed");

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      throw new InvalidMediaError(
        "Audio probe returned invalid metadata.",
        "audio_probe_invalid_output"
      );
    }
    const seconds = durationSeconds(parsed);
    if (seconds === undefined) {
      throw new InvalidMediaError("Audio duration is unavailable.", "audio_duration_unavailable");
    }
    return Math.round(seconds * 1000);
  }

  private assertProcessSucceeded(result: ProcessResult, invalidCode: string): void {
    if (result.timedOut) {
      throw new SttUnavailableError("Audio processing timed out.", "audio_processing_timeout");
    }
    if (result.spawnErrorCode === "ENOENT") {
      throw new SttUnavailableError(
        "Audio processing dependency is unavailable.",
        "audio_dependency_unavailable"
      );
    }
    if (result.exitCode !== 0) {
      throw new InvalidMediaError("Audio could not be decoded.", invalidCode);
    }
  }
}

export class NodeProcessRunner implements ProcessRunner {
  async run(input: {
    command: string;
    args: string[];
    timeoutMs: number;
    stdin?: string | Uint8Array;
  }): Promise<ProcessResult> {
    return new Promise((resolve) => {
      const child = spawn(input.command, input.args, {
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"]
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let timedOut = false;
      let spawnErrorCode: string | undefined;
      const timeout = setTimeout(() => {
        timedOut = true;
        if (child.pid !== undefined && process.platform !== "win32") {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        } else {
          child.kill("SIGKILL");
        }
      }, input.timeoutMs);

      if (input.stdin !== undefined && child.stdin) {
        child.stdin.end(input.stdin);
      } else if (child.stdin) {
        child.stdin.end();
      }
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.on("error", (error: NodeJS.ErrnoException) => {
        spawnErrorCode = error.code;
      });
      child.on("close", (exitCode) => {
        clearTimeout(timeout);
        resolve({
          exitCode: exitCode ?? -1,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          timedOut,
          ...(spawnErrorCode ? { spawnErrorCode } : {})
        });
      });
    });
  }
}

function durationSeconds(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null || !("format" in value)) {
    return undefined;
  }
  const format = value.format;
  if (typeof format !== "object" || format === null || !("duration" in format)) {
    return undefined;
  }
  const duration = format.duration;
  if (typeof duration !== "string" && typeof duration !== "number") {
    return undefined;
  }
  const seconds = Number(duration);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
