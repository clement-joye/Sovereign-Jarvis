import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import {
  loadBaseServiceConfig,
  loadMediaWorkerConfig,
  loadMediaWorkerRuntimeConfig,
  type MediaWorkerConfig
} from "@second-brain/configuration";
import {
  DeterministicMediaProcessor,
  FileAttachmentStore,
  FileTranscriptionCache,
  FfmpegAudioNormalizer,
  NodeProcessRunner,
  PiperTtsSynthesizer,
  WhisperCppTranscriber,
  type TranscriptionResult
} from "@second-brain/media-adapter";
import { createStructuredLogger } from "@second-brain/observability";

import { createMediaServer } from "./media-server.js";

const config = loadBaseServiceConfig("media-worker");
const mediaConfig = loadMediaWorkerConfig();
const runtimeConfig = loadMediaWorkerRuntimeConfig();
const logger = createStructuredLogger({
  service: config.serviceName,
  environment: config.environment,
  version: "0.0.0"
});

function createProcessor(
  media: MediaWorkerConfig
): DeterministicMediaProcessor | ConfiguredMediaProcessor {
  const fallback = new DeterministicMediaProcessor();
  if (media.sttProvider === "deterministic" && media.ttsProvider === "deterministic")
    return fallback;
  const attachments = new FileAttachmentStore(media.exchangeRoot);
  const runner = new NodeProcessRunner();
  const transcriber =
    media.sttProvider === "whisper-cpp"
      ? new WhisperCppTranscriber({
          normalizer: new FfmpegAudioNormalizer({
            attachments,
            runner,
            tempRoot: media.tempRoot,
            ffprobeBinary: media.ffprobeBinary,
            ffmpegBinary: media.ffmpegBinary,
            normalizeTimeoutMs: media.audioNormalizeTimeoutMs
          }),
          runner,
          cache: new FileTranscriptionCache(
            media.cacheRoot,
            media.sttCacheMaxAgeMs,
            media.sttCacheMaxBytes
          ),
          binary: media.whisperCppBinary,
          modelPath: media.whisperCppModelPath,
          modelVersion: `${media.whisperCppRuntimeVersion}:${media.whisperCppModelId}:${media.whisperCppModelSha256}`,
          language: media.whisperCppLanguage,
          timeoutMs: media.sttTimeoutMs,
          maxConcurrency: media.sttMaxConcurrency
        })
      : undefined;
  const synthesizer =
    media.ttsProvider === "piper"
      ? new PiperTtsSynthesizer({
          attachments,
          runner,
          binary: media.piperBinary ?? "/opt/piper/piper",
          modelPath: media.piperModelPath!,
          voiceId: media.piperModelId!,
          version: `${media.piperRuntimeVersion!}:${media.piperModelId!}:${media.piperModelSha256!}`,
          ffmpegBinary:
            media.sttProvider === "whisper-cpp" ? media.ffmpegBinary : "/usr/bin/ffmpeg",
          tempRoot: media.tempRoot,
          timeoutMs: media.ttsTimeoutMs
        })
      : undefined;
  return new ConfiguredMediaProcessor({
    fallback,
    transcriber,
    synthesizer
  });
}

class ConfiguredMediaProcessor {
  constructor(
    private readonly dependencies: {
      fallback: DeterministicMediaProcessor;
      transcriber?: WhisperCppTranscriber | undefined;
      synthesizer?: PiperTtsSynthesizer | undefined;
    }
  ) {}

  get availableSlots(): number {
    return this.dependencies.transcriber?.availableSlots ?? 0;
  }

  async transcribeAudio(
    attachment: Parameters<DeterministicMediaProcessor["transcribeAudio"]>[0]
  ): Promise<TranscriptionResult> {
    return (
      this.dependencies.transcriber?.transcribeAudio(attachment) ??
      this.dependencies.fallback.transcribeAudio(attachment)
    );
  }

  async prepareImage(
    attachment: Parameters<DeterministicMediaProcessor["prepareImage"]>[0]
  ): ReturnType<DeterministicMediaProcessor["prepareImage"]> {
    return this.dependencies.fallback.prepareImage(attachment);
  }

  async synthesizeAudio(
    input: Parameters<DeterministicMediaProcessor["synthesizeAudio"]>[0]
  ): ReturnType<DeterministicMediaProcessor["synthesizeAudio"]> {
    return (
      this.dependencies.synthesizer?.synthesizeAudio(input) ??
      this.dependencies.fallback.synthesizeAudio(input)
    );
  }
}

await verifyConfiguredModels(mediaConfig);
const processor = createProcessor(mediaConfig);

const server = createMediaServer({
  processor,
  stt: sttHealth(mediaConfig, processor),
  tts: ttsHealth(mediaConfig),
  logger
});

server.listen(runtimeConfig.port, () => {
  logger.info("Media Worker started", { port: runtimeConfig.port });
});

function sttHealth(
  media: MediaWorkerConfig,
  processor: DeterministicMediaProcessor | ConfiguredMediaProcessor
): { provider: string; ready: boolean; availableSlots?: number; modelVersion?: string } {
  if (media.sttProvider === "deterministic") {
    return { provider: "deterministic", ready: true };
  }
  return {
    provider: "whisper-cpp",
    ready: true,
    availableSlots: processor instanceof ConfiguredMediaProcessor ? processor.availableSlots : 0,
    modelVersion: `${media.whisperCppRuntimeVersion}:${media.whisperCppModelId}`
  };
}

function ttsHealth(media: MediaWorkerConfig): {
  provider: string;
  ready: boolean;
  modelVersion?: string;
} {
  if (media.ttsProvider === "deterministic") return { provider: "deterministic", ready: true };
  return {
    provider: "piper",
    ready: true,
    modelVersion: `${media.piperRuntimeVersion}:${media.piperModelId}`
  };
}

async function verifyConfiguredModels(media: MediaWorkerConfig): Promise<void> {
  if (media.sttProvider === "whisper-cpp")
    await verifyModel(media.whisperCppModelPath, media.whisperCppModelSha256, "whisper.cpp");
  if (media.ttsProvider === "piper")
    await verifyModel(media.piperModelPath!, media.piperModelSha256!, "Piper");
}

async function verifyModel(path: string, expectedHash: string, name: string): Promise<void> {
  const model = await stat(path);
  if (!model.isFile()) {
    throw new Error(`Configured ${name} model path is not a regular file.`);
  }
  const actualHash = await sha256File(path);
  if (actualHash !== expectedHash.toLowerCase()) {
    throw new Error(`Configured ${name} model checksum does not match.`);
  }
}

async function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk: string | Buffer) => {
      hash.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
