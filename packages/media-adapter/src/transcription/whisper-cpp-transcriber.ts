import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { AttachmentReferenceV1 } from "@second-brain/contracts";

import type { NormalizedAudio, ProcessRunner } from "../audio/ffmpeg-audio-normalizer.js";
import { InvalidMediaError, SttUnavailableError } from "../media-processing-error.js";
import { transcriptionCacheKey, type TranscriptionResult } from "../index.js";
import type { TranscriptionCache } from "./transcription-cache.js";

export interface AudioNormalizer {
  normalize(attachment: AttachmentReferenceV1): Promise<NormalizedAudio>;
}

export interface WhisperCppTranscriberOptions {
  normalizer: AudioNormalizer;
  runner: ProcessRunner;
  cache: TranscriptionCache;
  binary: string;
  modelPath: string;
  modelVersion: string;
  language?: string;
  timeoutMs?: number;
  maxConcurrency?: number;
  readOutput?: (path: string) => Promise<string>;
}

export class WhisperCppTranscriber {
  private active = 0;
  private readonly language: string;
  private readonly timeoutMs: number;
  private readonly maxConcurrency: number;
  private readonly readOutput: (path: string) => Promise<string>;

  constructor(private readonly options: WhisperCppTranscriberOptions) {
    this.language = options.language ?? "auto";
    this.timeoutMs = options.timeoutMs ?? 180_000;
    this.maxConcurrency = options.maxConcurrency ?? 1;
    this.readOutput = options.readOutput ?? ((path) => readFile(path, "utf8"));
  }

  get availableSlots(): number {
    return Math.max(0, this.maxConcurrency - this.active);
  }

  async transcribeAudio(attachment: AttachmentReferenceV1): Promise<TranscriptionResult> {
    this.acquire();
    let normalized: NormalizedAudio | undefined;
    try {
      normalized = await this.options.normalizer.normalize(attachment);
      const cacheKey = transcriptionCacheKey({
        sourceSha256: normalized.sourceSha256,
        modelVersion: this.options.modelVersion,
        options: { language: this.language }
      });
      const cached = await this.options.cache.get(cacheKey);
      if (cached !== undefined) {
        return cached;
      }

      const outputBase = join(dirname(normalized.path), "transcript");
      const result = await this.options.runner.run({
        command: this.options.binary,
        args: [
          "-m",
          this.options.modelPath,
          "-f",
          normalized.path,
          "-l",
          this.language,
          "-oj",
          "-of",
          outputBase,
          "-np",
          "-ng"
        ],
        timeoutMs: this.timeoutMs
      });
      if (result.timedOut || result.spawnErrorCode === "ENOENT" || result.exitCode !== 0) {
        throw new SttUnavailableError(whisperFailureMessage(result));
      }

      const transcript = parseWhisperJson(await this.readOutput(`${outputBase}.json`));
      const value: TranscriptionResult = { ...transcript, warnings: [], cacheKey };
      await this.options.cache.put(cacheKey, value);
      return value;
    } finally {
      this.active -= 1;
      if (normalized !== undefined) {
        await normalized.cleanup();
      }
    }
  }

  private acquire(): void {
    if (this.active >= this.maxConcurrency) {
      throw new SttUnavailableError(
        "Speech-to-text capacity is exhausted.",
        "stt_capacity_exhausted"
      );
    }
    this.active += 1;
  }
}

function whisperFailureMessage(result: {
  exitCode: number;
  stderr: string;
  timedOut: boolean;
  spawnErrorCode?: string;
}): string {
  if (result.timedOut) {
    return "whisper.cpp transcription timed out.";
  }
  if (result.spawnErrorCode === "ENOENT") {
    return "whisper.cpp executable is unavailable.";
  }
  const detail = result.stderr.replace(/\s+/g, " ").trim().slice(0, 1000);
  return detail
    ? `whisper.cpp exited with code ${result.exitCode}: ${detail}`
    : `whisper.cpp exited with code ${result.exitCode}.`;
}

export function parseWhisperJson(raw: string): { text: string; language?: string } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new SttUnavailableError("whisper.cpp returned invalid JSON.", "stt_invalid_output");
  }
  if (!isRecord(value) || !Array.isArray(value.transcription)) {
    throw new SttUnavailableError(
      "whisper.cpp returned an unsupported JSON schema.",
      "stt_invalid_output"
    );
  }
  const text = value.transcription
    .map((segment) =>
      isRecord(segment) && typeof segment.text === "string" ? segment.text : undefined
    )
    .filter((segment): segment is string => segment !== undefined)
    .join(" ")
    .trim();
  if (text.length === 0 || text.length > 100_000) {
    throw new InvalidMediaError("Audio contained no usable speech.", "empty_transcript");
  }
  const language =
    isRecord(value.result) && typeof value.result.language === "string"
      ? value.result.language
      : undefined;
  return { text, ...(language ? { language } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
