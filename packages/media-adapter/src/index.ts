import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";

import type { AttachmentReferenceV1 } from "@second-brain/contracts";

export { FileAttachmentStore } from "./attachments/file-attachment-store.js";
export {
  FfmpegAudioNormalizer,
  NodeProcessRunner,
  type AttachmentReader,
  type FfmpegAudioNormalizerOptions,
  type NormalizedAudio,
  type ProcessResult,
  type ProcessRunner
} from "./audio/ffmpeg-audio-normalizer.js";
export {
  FileTranscriptionCache,
  type TranscriptionCache
} from "./transcription/transcription-cache.js";
export {
  WhisperCppTranscriber,
  parseWhisperJson,
  type AudioNormalizer,
  type WhisperCppTranscriberOptions
} from "./transcription/whisper-cpp-transcriber.js";
export { PiperTtsSynthesizer, type PiperTtsSynthesizerOptions } from "./piper-tts-synthesizer.js";
export {
  InvalidMediaError,
  MediaProcessingError,
  MissingAttachmentError,
  SttUnavailableError
} from "./media-processing-error.js";

export interface MediaLimits {
  maxImageBytes: number;
  maxAudioBytes: number;
  maxAudioDurationMs: number;
  maxImagePixels: number;
  maxTtsCharacters: number;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  confidence?: number;
  warnings: string[];
  cacheKey: string;
}

export interface SpeechSynthesisResult {
  audio: AttachmentReferenceV1;
  cacheKey: string;
}

export interface ImagePreparationOptions {
  targetProfile: "pi-input";
  processorVersion?: string;
}

export const defaultMediaLimits: MediaLimits = {
  maxImageBytes: 15 * 1024 * 1024,
  maxAudioBytes: 25 * 1024 * 1024,
  maxAudioDurationMs: 10 * 60 * 1000,
  maxImagePixels: 24_000_000,
  maxTtsCharacters: 5_000
};

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const AUDIO_TYPES = new Set(["audio/ogg", "audio/opus", "audio/mpeg", "audio/mp4", "audio/wav"]);

export function assertOpaqueStorageKey(storageKey: string): void {
  if (
    storageKey.length === 0 ||
    storageKey.startsWith("/") ||
    storageKey.includes("..") ||
    storageKey.includes("\\") ||
    storageKey.split("/").some((part) => part === "." || part.length === 0)
  ) {
    throw new Error("Attachment storage keys must be opaque relative keys.");
  }
}

export async function resolveAttachmentPath(input: {
  exchangeRoot: string;
  storageKey: string;
}): Promise<string> {
  assertOpaqueStorageKey(input.storageKey);
  const root = resolve(input.exchangeRoot);
  const candidate = resolve(root, input.storageKey);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    throw new Error("Attachment path escapes exchange root.");
  }

  const stat = await lstat(candidate);
  if (stat.isSymbolicLink()) {
    const target = await realpath(candidate);
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      throw new Error("Attachment symlink escapes exchange root.");
    }
  }
  if (!stat.isFile()) {
    throw new Error("Attachment storage key must resolve to a regular file.");
  }
  return candidate;
}

export function validateImageAttachment(
  attachment: AttachmentReferenceV1,
  limits: MediaLimits = defaultMediaLimits
): void {
  assertOpaqueStorageKey(attachment.storageKey);
  if (!IMAGE_TYPES.has(attachment.mediaType)) {
    throw new Error(`Unsupported image media type: ${attachment.mediaType}`);
  }
  if (attachment.sizeBytes > limits.maxImageBytes) {
    throw new Error("Image exceeds maximum byte size.");
  }
  if (!attachment.width || !attachment.height) {
    throw new Error("Image dimensions are required.");
  }
  if (attachment.width * attachment.height > limits.maxImagePixels) {
    throw new Error("Image exceeds maximum pixel count.");
  }
}

export function validateAudioAttachment(
  attachment: AttachmentReferenceV1,
  limits: MediaLimits = defaultMediaLimits
): void {
  assertOpaqueStorageKey(attachment.storageKey);
  if (!AUDIO_TYPES.has(attachment.mediaType)) {
    throw new Error(`Unsupported audio media type: ${attachment.mediaType}`);
  }
  if (attachment.sizeBytes > limits.maxAudioBytes) {
    throw new Error("Audio exceeds maximum byte size.");
  }
  if (attachment.durationMs !== undefined && attachment.durationMs > limits.maxAudioDurationMs) {
    throw new Error("Audio exceeds maximum duration.");
  }
}

export function preparedAttachmentFrom(
  source: AttachmentReferenceV1,
  storageKey: string
): AttachmentReferenceV1 {
  assertOpaqueStorageKey(storageKey);

  return {
    ...source,
    id: `${source.id}-prepared`,
    purpose: "prepared",
    storageKey
  };
}

export function imageCacheKey(input: {
  sourceSha256: string;
  processorVersion: string;
  targetProfile: string;
}): string {
  return `image:${sha256(`${input.sourceSha256}:${input.processorVersion}:${input.targetProfile}`)}`;
}

export function transcriptionCacheKey(input: {
  sourceSha256: string;
  modelVersion: string;
  options?: Record<string, unknown>;
}): string {
  return `transcription:${sha256(
    JSON.stringify({
      sourceSha256: input.sourceSha256,
      modelVersion: input.modelVersion,
      options: input.options ?? {}
    })
  )}`;
}

export function ttsCacheKey(input: {
  text: string;
  voiceId: string;
  ttsVersion: string;
  format: string;
}): string {
  return `tts:${sha256(
    JSON.stringify({
      text: normalizeTtsText(input.text),
      voiceId: input.voiceId,
      ttsVersion: input.ttsVersion,
      format: input.format
    })
  )}`;
}

export function normalizeTtsText(text: string): string {
  return (
    text
      // Code is useful in the Matrix transcript but not intelligible when read
      // aloud. Keep inline-code content while omitting fenced blocks entirely.
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]+)`/g, "$1")
      // Prefer the human-readable label over the URL for Markdown links.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
      // Remove HTML and common block-level Markdown punctuation.
      .replace(/<[^>]*>/g, " ")
      .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gm, "")
      .replace(/^(?:\s*\|)?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, " ")
      .replace(/\|/g, " ")
      // Remove paired emphasis, strikethrough, and escaped Markdown symbols.
      .replace(/(\*\*|__|~~)([\s\S]*?)\1/g, "$2")
      .replace(/\\([\\`*{}\[\]()#+.!_>~-])/g, "$1")
      .trim()
      .replace(/\s+/g, " ")
  );
}

export class DeterministicMediaProcessor {
  constructor(private readonly limits: MediaLimits = defaultMediaLimits) {}

  async prepareImage(
    attachment: AttachmentReferenceV1,
    options: ImagePreparationOptions = { targetProfile: "pi-input" }
  ): Promise<AttachmentReferenceV1> {
    validateImageAttachment(attachment, this.limits);
    const processorVersion = options.processorVersion ?? "fake-image-v1";
    const key = imageCacheKey({
      sourceSha256: attachment.sha256,
      processorVersion,
      targetProfile: options.targetProfile
    });
    return preparedAttachmentFrom(attachment, `prepared/images/${key}`);
  }

  async transcribeAudio(attachment: AttachmentReferenceV1): Promise<TranscriptionResult> {
    validateAudioAttachment(attachment, this.limits);
    return {
      text: `transcript:${attachment.id}`,
      language: "en",
      confidence: 1,
      warnings: [],
      cacheKey: transcriptionCacheKey({
        sourceSha256: attachment.sha256,
        modelVersion: "fake-stt-v1"
      })
    };
  }

  async synthesizeAudio(input: {
    text: string;
    voiceId?: string;
    id?: string;
  }): Promise<SpeechSynthesisResult> {
    const normalized = normalizeTtsText(input.text);
    if (normalized.length === 0) {
      throw new Error("TTS text must not be empty.");
    }
    if (normalized.length > this.limits.maxTtsCharacters) {
      throw new Error("TTS text exceeds maximum length.");
    }

    const voiceId = input.voiceId ?? "default";
    const cacheKey = ttsCacheKey({
      text: normalized,
      voiceId,
      ttsVersion: "fake-tts-v1",
      format: "audio/ogg"
    });

    return {
      cacheKey,
      audio: {
        schemaVersion: 1,
        id: input.id ?? `tts-${cacheKey.slice(-16)}`,
        purpose: "outbound",
        mediaType: "audio/ogg",
        sizeBytes: Buffer.byteLength(normalized),
        sha256: sha256(normalized),
        storageKey: `outbound/audio/${cacheKey}.ogg`,
        durationMs: Math.max(1000, normalized.length * 40)
      }
    };
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
