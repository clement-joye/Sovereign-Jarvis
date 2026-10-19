import { z } from "zod";

const positiveInteger = z.coerce.number().int().positive();
const WhisperCppMediaConfigSchema = z.object({
  sttProvider: z.literal("whisper-cpp"),
  exchangeRoot: z.string().min(1),
  cacheRoot: z.string().min(1),
  tempRoot: z.string().min(1),
  whisperCppBinary: z.string().min(1),
  whisperCppModelPath: z.string().min(1),
  whisperCppRuntimeVersion: z.string().min(1),
  whisperCppModelId: z.string().min(1),
  whisperCppModelSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  whisperCppLanguage: z.string().min(1),
  ffprobeBinary: z.string().min(1),
  ffmpegBinary: z.string().min(1),
  audioNormalizeTimeoutMs: positiveInteger,
  sttTimeoutMs: positiveInteger,
  sttMaxConcurrency: positiveInteger,
  sttCacheMaxAgeMs: positiveInteger,
  sttCacheMaxBytes: positiveInteger
});
const PiperTtsConfigSchema = z.object({
  ttsProvider: z.enum(["deterministic", "piper"]),
  piperBinary: z.string().min(1).optional(),
  piperModelPath: z.string().min(1).optional(),
  piperRuntimeVersion: z.string().min(1).optional(),
  piperModelId: z.string().min(1).optional(),
  piperModelSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  ttsTimeoutMs: positiveInteger
});
const DeterministicMediaConfigSchema = z.object({
  sttProvider: z.literal("deterministic"),
  exchangeRoot: z.string().min(1),
  cacheRoot: z.string().min(1),
  tempRoot: z.string().min(1)
});

export const MediaWorkerConfigSchema = z.intersection(
  z.discriminatedUnion("sttProvider", [
    WhisperCppMediaConfigSchema,
    DeterministicMediaConfigSchema
  ]),
  PiperTtsConfigSchema
);
export type MediaWorkerConfig = z.infer<typeof MediaWorkerConfigSchema>;

export function loadMediaWorkerConfig(env: NodeJS.ProcessEnv = process.env): MediaWorkerConfig {
  const environment = env.SECOND_BRAIN_ENVIRONMENT ?? env.NODE_ENV ?? "dev";
  const sttProvider =
    env.MEDIA_STT_PROVIDER ?? (environment === "production" ? "whisper-cpp" : "deterministic");
  const shared = mediaSharedConfig(env, sttProvider, environment);
  return sttProvider === "deterministic"
    ? deterministicMediaConfig(shared, environment)
    : whisperCppMediaConfig(shared, env, environment);
}

interface MediaSharedConfig {
  sttProvider: string;
  exchangeRoot: string;
  cacheRoot: string;
  tempRoot: string;
  ttsProvider: string;
  piperBinary: string;
  piperModelPath: string | undefined;
  piperRuntimeVersion: string | undefined;
  piperModelId: string | undefined;
  piperModelSha256: string | undefined;
  ttsTimeoutMs: string;
}

function mediaSharedConfig(
  env: NodeJS.ProcessEnv,
  sttProvider: string,
  environment: string
): MediaSharedConfig {
  return {
    sttProvider,
    exchangeRoot: env.MEDIA_EXCHANGE_ROOT ?? "/brain/exchange",
    cacheRoot: env.MEDIA_CACHE_ROOT ?? "/brain/media-cache",
    tempRoot: env.MEDIA_TEMP_ROOT ?? "/tmp",
    ttsProvider:
      env.MEDIA_TTS_PROVIDER ?? (environment === "production" ? "piper" : "deterministic"),
    piperBinary: env.PIPER_BINARY ?? "/opt/piper/piper",
    piperModelPath: env.PIPER_MODEL_PATH,
    piperRuntimeVersion: env.PIPER_RUNTIME_VERSION,
    piperModelId: env.PIPER_MODEL_ID,
    piperModelSha256: env.PIPER_MODEL_SHA256,
    ttsTimeoutMs: env.MEDIA_TTS_TIMEOUT_MS ?? "60000"
  };
}

function deterministicMediaConfig(
  shared: MediaSharedConfig,
  environment: string
): MediaWorkerConfig {
  if (environment === "production")
    throw new Error("MEDIA_STT_PROVIDER=deterministic is not permitted in production.");
  return parseMediaWorkerConfig(shared, environment);
}

function whisperCppMediaConfig(
  shared: MediaSharedConfig,
  env: NodeJS.ProcessEnv,
  environment: string
): MediaWorkerConfig {
  return parseMediaWorkerConfig(
    {
      ...shared,
      whisperCppBinary: env.WHISPER_CPP_BINARY ?? "/usr/local/bin/whisper-cli",
      whisperCppModelPath: env.WHISPER_CPP_MODEL_PATH,
      whisperCppRuntimeVersion: env.WHISPER_CPP_RUNTIME_VERSION,
      whisperCppModelId: env.WHISPER_CPP_MODEL_ID,
      whisperCppModelSha256: env.WHISPER_CPP_MODEL_SHA256,
      whisperCppLanguage: env.WHISPER_CPP_LANGUAGE ?? "auto",
      ffprobeBinary: env.MEDIA_FFPROBE_BINARY ?? "/usr/bin/ffprobe",
      ffmpegBinary: env.MEDIA_FFMPEG_BINARY ?? "/usr/bin/ffmpeg",
      audioNormalizeTimeoutMs: env.MEDIA_AUDIO_NORMALIZE_TIMEOUT_MS ?? "30000",
      sttTimeoutMs: env.MEDIA_STT_TIMEOUT_MS ?? "180000",
      sttMaxConcurrency: env.MEDIA_STT_MAX_CONCURRENCY ?? "1",
      sttCacheMaxAgeMs: env.MEDIA_STT_CACHE_MAX_AGE_MS ?? "604800000",
      sttCacheMaxBytes: env.MEDIA_STT_CACHE_MAX_BYTES ?? "1073741824"
    },
    environment
  );
}

function parseMediaWorkerConfig(input: unknown, environment: string): MediaWorkerConfig {
  const config = MediaWorkerConfigSchema.parse(input);
  if (config.ttsProvider === "deterministic" && environment === "production") {
    throw new Error("MEDIA_TTS_PROVIDER=deterministic is not permitted in production.");
  }
  if (config.ttsProvider === "piper") requirePiperModelIdentity(config);
  return config;
}

function requirePiperModelIdentity(config: MediaWorkerConfig): void {
  if (
    !config.piperModelPath ||
    !config.piperRuntimeVersion ||
    !config.piperModelId ||
    !config.piperModelSha256
  ) {
    throw new Error("Piper TTS requires a pinned model identity.");
  }
}
