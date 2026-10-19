import { createHash } from "node:crypto";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { AttachmentReferenceV1 } from "@second-brain/contracts";

import {
  FileTranscriptionCache,
  FfmpegAudioNormalizer,
  NodeProcessRunner,
  WhisperCppTranscriber
} from "./index.js";

const binary = process.env.WHISPER_CPP_INTEGRATION_BINARY;
const modelPath = process.env.WHISPER_CPP_INTEGRATION_MODEL_PATH;
const audioPath = process.env.WHISPER_CPP_INTEGRATION_AUDIO_PATH;
const expectedText = process.env.WHISPER_CPP_INTEGRATION_EXPECT_TEXT;
const enabled =
  binary !== undefined &&
  modelPath !== undefined &&
  audioPath !== undefined &&
  expectedText !== undefined &&
  (await allExist([binary, modelPath, audioPath]));

describe("whisper.cpp integration", () => {
  it.skipIf(!enabled)(
    "transcribes a pinned real-model fixture and reuses the cache",
    async () => {
      const source = await readFile(audioPath as string);
      const root = await mkdtemp(join(tmpdir(), "whisper-cpp-integration-"));
      const runner = new NodeProcessRunner();
      const transcriber = new WhisperCppTranscriber({
        normalizer: new FfmpegAudioNormalizer({
          attachments: { open: async () => source },
          runner,
          tempRoot: root,
          ffprobeBinary: process.env.MEDIA_FFPROBE_BINARY ?? "/usr/bin/ffprobe",
          ffmpegBinary: process.env.MEDIA_FFMPEG_BINARY ?? "/usr/bin/ffmpeg"
        }),
        runner,
        cache: new FileTranscriptionCache(join(root, "cache"), 60_000, 1_000_000),
        binary: binary as string,
        modelPath: modelPath as string,
        modelVersion: process.env.WHISPER_CPP_INTEGRATION_MODEL_VERSION ?? "integration-pinned",
        language: process.env.WHISPER_CPP_INTEGRATION_LANGUAGE ?? "auto"
      });
      const attachment = reference(source);

      const first = await transcriber.transcribeAudio(attachment);
      const second = await transcriber.transcribeAudio(attachment);

      expect(first.text.toLocaleLowerCase()).toContain(
        (expectedText as string).toLocaleLowerCase()
      );
      expect(second).toEqual(first);
    },
    60_000
  );
});

async function allExist(paths: string[]): Promise<boolean> {
  try {
    await Promise.all(paths.map(async (path) => access(path)));
    return true;
  } catch {
    return false;
  }
}

function reference(source: Uint8Array): AttachmentReferenceV1 {
  return {
    schemaVersion: 1,
    id: "whisper-integration-audio",
    purpose: "inbound",
    mediaType: "audio/ogg",
    sizeBytes: source.byteLength,
    sha256: createHash("sha256").update(source).digest("hex"),
    storageKey: "inbound/whisper-integration.ogg"
  };
}
