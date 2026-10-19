import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AttachmentReferenceV1 } from "@second-brain/contracts";

import { InvalidMediaError, SttUnavailableError } from "./media-processing-error.js";
import {
  defaultMediaLimits,
  normalizeTtsText,
  ttsCacheKey,
  type MediaLimits,
  type SpeechSynthesisResult
} from "./index.js";
import type { ProcessRunner } from "./audio/ffmpeg-audio-normalizer.js";

export interface AttachmentWriter {
  put(input: {
    bytes: Uint8Array;
    reference: AttachmentReferenceV1;
  }): Promise<AttachmentReferenceV1>;
}

export interface PiperTtsSynthesizerOptions {
  attachments: AttachmentWriter;
  runner: ProcessRunner;
  binary: string;
  modelPath: string;
  voiceId: string;
  version: string;
  ffmpegBinary: string;
  tempRoot?: string;
  timeoutMs?: number;
  limits?: MediaLimits;
}

/** Synthesizes local Piper speech and stores the Matrix-friendly OGG/Opus result. */
export class PiperTtsSynthesizer {
  private readonly tempRoot: string;
  private readonly timeoutMs: number;
  private readonly limits: MediaLimits;

  constructor(private readonly options: PiperTtsSynthesizerOptions) {
    this.tempRoot = options.tempRoot ?? tmpdir();
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.limits = options.limits ?? defaultMediaLimits;
  }

  async synthesizeAudio(input: {
    text: string;
    voiceId?: string;
    id?: string;
  }): Promise<SpeechSynthesisResult> {
    const text = normalizeTtsText(input.text);
    if (!text) throw new InvalidMediaError("TTS text must not be empty.", "tts_empty_text");
    if (text.length > this.limits.maxTtsCharacters) {
      throw new InvalidMediaError("TTS text exceeds maximum length.", "tts_text_too_long");
    }
    const voiceId = input.voiceId ?? this.options.voiceId;
    const cacheKey = ttsCacheKey({
      text,
      voiceId,
      ttsVersion: this.options.version,
      format: "audio/ogg"
    });
    const storageKey = `outbound/audio/${cacheKey}.ogg`;
    const directory = await mkdtemp(join(this.tempRoot, "second-brain-tts-"));
    const wav = join(directory, "speech.wav");
    const ogg = join(directory, "speech.ogg");
    try {
      assertSucceeded(
        await this.options.runner.run({
          command: this.options.binary,
          args: ["--model", this.options.modelPath, "--output_file", wav],
          stdin: `${text}\n`,
          timeoutMs: this.timeoutMs
        }),
        "Piper synthesis failed."
      );
      assertSucceeded(
        await this.options.runner.run({
          command: this.options.ffmpegBinary,
          args: ["-nostdin", "-v", "error", "-i", wav, "-c:a", "libopus", "-b:a", "48k", ogg],
          timeoutMs: this.timeoutMs
        }),
        "Audio encoding failed."
      );
      const file = await stat(ogg);
      if (!file.isFile() || file.size === 0 || file.size > this.limits.maxAudioBytes) {
        throw new InvalidMediaError(
          "Speech synthesis produced invalid audio.",
          "tts_invalid_output"
        );
      }
      const bytes = await readFile(ogg);
      const audio: AttachmentReferenceV1 = {
        schemaVersion: 1,
        id: input.id ?? `tts-${cacheKey.slice(-16)}`,
        purpose: "outbound",
        mediaType: "audio/ogg",
        sizeBytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        storageKey
      };
      await this.options.attachments.put({ bytes, reference: audio });
      return { cacheKey, audio };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

function assertSucceeded(
  result: { exitCode: number; timedOut: boolean; spawnErrorCode?: string; stderr: string },
  message: string
): void {
  if (result.timedOut || result.spawnErrorCode === "ENOENT" || result.exitCode !== 0) {
    const detail = result.stderr.replace(/\s+/g, " ").trim().slice(0, 500);
    const status = result.timedOut
      ? "timed out"
      : result.spawnErrorCode
        ? `spawn error ${result.spawnErrorCode}`
        : `exit code ${result.exitCode}`;
    throw new SttUnavailableError(
      detail ? `${message} (${status}). ${detail}` : `${message} (${status}).`,
      "tts_unavailable"
    );
  }
}
