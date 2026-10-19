import { z } from "zod";

export * from "./single-flight.js";
export * from "./media-worker-config.js";

export const BaseServiceConfigSchema = z.object({
  serviceName: z.string().min(1),
  environment: z.string().min(1).default("dev"),
  logLevel: z.enum(["trace", "debug", "info", "warn", "error"]).default("info")
});

export type BaseServiceConfig = z.infer<typeof BaseServiceConfigSchema>;

export function loadBaseServiceConfig(
  serviceName: string,
  env: NodeJS.ProcessEnv = process.env
): BaseServiceConfig {
  return BaseServiceConfigSchema.parse({
    serviceName,
    environment: env.SECOND_BRAIN_ENVIRONMENT ?? env.NODE_ENV ?? "dev",
    logLevel: env.LOG_LEVEL ?? "info"
  });
}

const PlatformCatalogPathSchema = z.string().min(1);

/** Returns the required immutable platform-catalog release artifact path. */
export function loadPlatformCatalogPath(env: NodeJS.ProcessEnv = process.env): string {
  return PlatformCatalogPathSchema.parse(env.PLATFORM_CATALOG_PATH);
}

const positiveInteger = z.coerce.number().int().positive();
const portNumber = z.coerce.number().int().min(1).max(65_535);
const brainWorkerJobType = z.enum([
  "process_inbound",
  "run_schedule",
  "run_agent",
  "progress_notice"
]);
const httpUrl = z
  .string()
  .url()
  .refine(
    (value) => ["http:", "https:"].includes(new URL(value).protocol),
    "Expected an HTTP(S) URL."
  );
export const BrainWorkerConfigSchema = z
  .object({
    controlUrl: httpUrl,
    mediaWorkerUrl: httpUrl,
    pollIntervalMs: positiveInteger,
    sessionIdleContinuationMs: positiveInteger,
    sessionRetentionMs: positiveInteger,
    sessionDisplayTimezone: z.string().min(1),
    leaseMs: positiveInteger,
    claimLimit: positiveInteger,
    jobTypes: z.array(brainWorkerJobType).min(1),
    maxAttempts: positiveInteger,
    retryBaseDelayMs: positiveInteger,
    controlRequestTimeoutMs: positiveInteger,
    mediaRequestTimeoutMs: positiveInteger,
    piTimeoutSeconds: positiveInteger,
    workerCollaborationToken: z.string().min(1).optional()
  })
  .refine((config) => config.leaseMs >= config.piTimeoutSeconds * 1_000, {
    path: ["leaseMs"],
    message: "BRAIN_WORKER_LEASE_MS must be at least PI_TIMEOUT_SECONDS in milliseconds."
  });

export type BrainWorkerConfig = z.infer<typeof BrainWorkerConfigSchema>;

const opt = (env: NodeJS.ProcessEnv, key: string, fallback: string): string => env[key] ?? fallback;

export function loadBrainWorkerConfig(env: NodeJS.ProcessEnv = process.env): BrainWorkerConfig {
  return BrainWorkerConfigSchema.parse({
    controlUrl: opt(env, "BRAIN_CONTROL_URL", "http://brain-control:3000"),
    mediaWorkerUrl: opt(env, "MEDIA_WORKER_URL", "http://media-worker:3030"),
    pollIntervalMs: opt(env, "BRAIN_WORKER_POLL_INTERVAL_MS", "1000"),
    sessionIdleContinuationMs: opt(env, "SESSION_IDLE_CONTINUATION_MS", "86400000"),
    sessionRetentionMs: opt(env, "SESSION_RETENTION_MS", "604800000"),
    sessionDisplayTimezone: opt(env, "SCHEDULE_DISPLAY_TIMEZONE", "Europe/Stockholm"),
    leaseMs: opt(env, "BRAIN_WORKER_LEASE_MS", "660000"),
    claimLimit: opt(env, "BRAIN_WORKER_CLAIM_LIMIT", "1"),
    jobTypes: (
      env.BRAIN_WORKER_JOB_TYPES ?? "process_inbound,run_schedule,run_agent,progress_notice"
    )
      .split(",")
      .map((jobType) => jobType.trim())
      .filter(Boolean),
    maxAttempts: opt(env, "BRAIN_WORKER_MAX_ATTEMPTS", "3"),
    retryBaseDelayMs: opt(env, "BRAIN_WORKER_RETRY_BASE_DELAY_MS", "1000"),
    controlRequestTimeoutMs: opt(env, "BRAIN_WORKER_CONTROL_REQUEST_TIMEOUT_MS", "30000"),
    mediaRequestTimeoutMs: opt(env, "BRAIN_WORKER_MEDIA_REQUEST_TIMEOUT_MS", "240000"),
    piTimeoutSeconds: opt(env, "BRAIN_WORKER_PI_TIMEOUT_SECONDS", "600"),
    ...(env.BRAIN_CONTROL_WORKER_COLLABORATION_TOKEN
      ? { workerCollaborationToken: env.BRAIN_CONTROL_WORKER_COLLABORATION_TOKEN }
      : {})
  });
}

export const ServicePortConfigSchema = z.object({ port: portNumber });

export function loadServicePortConfig(
  value: string | undefined,
  defaultPort: number
): z.infer<typeof ServicePortConfigSchema> {
  return ServicePortConfigSchema.parse({ port: value ?? String(defaultPort) });
}

const enabledFlag = z.enum(["true", "false"]).transform((value) => value === "true");

export const SchedulerRuntimeConfigSchema = z.object({
  controlBaseUrl: httpUrl,
  intervalMs: positiveInteger,
  claimLimit: positiveInteger,
  runOnStart: enabledFlag
});

export type SchedulerRuntimeConfig = z.infer<typeof SchedulerRuntimeConfigSchema>;

export function loadSchedulerRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): SchedulerRuntimeConfig {
  return SchedulerRuntimeConfigSchema.parse({
    controlBaseUrl: env.BRAIN_CONTROL_URL ?? "http://localhost:3000",
    intervalMs: env.SCHEDULER_POLL_INTERVAL_MS ?? "30000",
    claimLimit: env.SCHEDULER_CLAIM_LIMIT ?? "10",
    runOnStart: env.SCHEDULER_RUN_ON_START ?? "false"
  });
}

export const RetentionWorkerRuntimeConfigSchema = z.object({
  controlBaseUrl: httpUrl,
  intervalMs: positiveInteger,
  dryRun: z.boolean(),
  limit: positiveInteger,
  runOnStart: enabledFlag
});

export type RetentionWorkerRuntimeConfig = z.infer<typeof RetentionWorkerRuntimeConfigSchema>;

export function loadRetentionWorkerRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): RetentionWorkerRuntimeConfig {
  return RetentionWorkerRuntimeConfigSchema.parse({
    controlBaseUrl: env.BRAIN_CONTROL_URL ?? "http://localhost:3000",
    intervalMs: env.RETENTION_POLL_INTERVAL_MS ?? "3600000",
    dryRun: env.RETENTION_DRY_RUN !== "false",
    limit: env.RETENTION_BATCH_LIMIT ?? "100",
    runOnStart: env.RETENTION_RUN_ON_START ?? "false"
  });
}

export const BrainControlRuntimeConfigSchema = z
  .object({
    port: portNumber,
    sessionIdleContinuationMs: positiveInteger,
    sessionRetentionMs: positiveInteger,
    retentionMs: positiveInteger,
    maxRetentionMs: positiveInteger,
    scheduleDisplayTimezone: z.string().min(1),
    agentRootConcurrency: positiveInteger,
    agentAdmissionLeaseSeconds: positiveInteger,
    agentAdmissionHeartbeatSeconds: positiveInteger
  })
  .refine(
    (config) => config.agentAdmissionLeaseSeconds >= config.agentAdmissionHeartbeatSeconds * 3,
    {
      path: ["agentAdmissionLeaseSeconds"],
      message:
        "AGENT_ADMISSION_LEASE_SECONDS must be at least three times AGENT_ADMISSION_HEARTBEAT_SECONDS."
    }
  );

export type BrainControlRuntimeConfig = z.infer<typeof BrainControlRuntimeConfigSchema>;

export function loadBrainControlRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): BrainControlRuntimeConfig {
  const sessionRetentionMs = env.SESSION_RETENTION_MS ?? "604800000";
  return BrainControlRuntimeConfigSchema.parse({
    port: env.BRAIN_CONTROL_PORT ?? "3000",
    sessionIdleContinuationMs: env.SESSION_IDLE_CONTINUATION_MS ?? "86400000",
    sessionRetentionMs,
    retentionMs: env.RETENTION_MS ?? sessionRetentionMs,
    maxRetentionMs: env.MAX_RETENTION_MS ?? "864000000",
    scheduleDisplayTimezone: env.SCHEDULE_DISPLAY_TIMEZONE ?? "Europe/Stockholm",
    agentRootConcurrency: env.AGENT_ROOT_CONCURRENCY ?? "1",
    agentAdmissionLeaseSeconds: env.AGENT_ADMISSION_LEASE_SECONDS ?? "90",
    agentAdmissionHeartbeatSeconds: env.AGENT_ADMISSION_HEARTBEAT_SECONDS ?? "30"
  });
}

export const RuntimeProvisionerClientConfigSchema = z.object({
  baseUrl: httpUrl,
  token: z.string().min(1)
});

export type RuntimeProvisionerClientConfig = z.infer<typeof RuntimeProvisionerClientConfigSchema>;

/**
 * The provisioner is optional outside deployments that support isolated
 * workspace runtimes. Supplying only one half of its credentials is a
 * configuration error rather than a silent fallback to an in-process runtime.
 */
export function loadRuntimeProvisionerClientConfig(
  env: NodeJS.ProcessEnv = process.env
): RuntimeProvisionerClientConfig | undefined {
  const baseUrl = env.RUNTIME_PROVISIONER_URL;
  const token = env.RUNTIME_PROVISIONER_TOKEN;
  if (!baseUrl && !token) return undefined;
  return RuntimeProvisionerClientConfigSchema.parse({ baseUrl, token });
}

export const PiRunnerRuntimeConfigSchema = z.object({
  port: portNumber,
  sessionRoot: z.string().min(1),
  runnerImplementation: z.string().min(1),
  workspaceRoot: z.string().min(1),
  profileRoot: z.string().startsWith("/").optional(),
  resourceRoot: z.string().startsWith("/").optional(),
  modelsPath: z.string().min(1),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  allowedTools: z
    .array(z.string().regex(/^[a-z][a-z0-9_]*$/))
    .min(1)
    .optional(),
  /** Immutable image identity injected by the runtime provisioner. */
  runtimeImageId: z
    .string()
    .regex(/^(?:[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}|sha256:[a-f0-9]{64})$/)
    .optional(),
  platformPolicyDigest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
  resourceDigest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
  brainControlUrl: httpUrl
});

export type PiRunnerRuntimeConfig = z.infer<typeof PiRunnerRuntimeConfigSchema>;

export function loadPiRunnerRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): PiRunnerRuntimeConfig {
  return PiRunnerRuntimeConfigSchema.parse({
    port: env.PI_RUNNER_PORT ?? "3010",
    sessionRoot: env.PI_SESSION_ROOT ?? "/brain/sessions",
    runnerImplementation: env.PI_RUNNER_IMPLEMENTATION ?? "deterministic",
    workspaceRoot: env.PI_WORKSPACE_ROOT ?? "/brain/workspace",
    ...(env.PI_PROFILE_ROOT ? { profileRoot: env.PI_PROFILE_ROOT } : {}),
    ...(env.PI_RESOURCE_ROOT ? { resourceRoot: env.PI_RESOURCE_ROOT } : {}),
    modelsPath: env.PI_MODELS_PATH ?? "/brain/config/models.json",
    providerId: env.PI_MODEL_PROVIDER_ID,
    modelId: env.PI_MODEL_ID,
    ...(env.PI_ALLOWED_TOOLS
      ? {
          allowedTools: parseToolAllowlist(env.PI_ALLOWED_TOOLS)
        }
      : {}),
    ...(env.PI_RUNTIME_IMAGE_ID ? { runtimeImageId: env.PI_RUNTIME_IMAGE_ID } : {}),
    ...(env.PI_PLATFORM_POLICY_DIGEST
      ? { platformPolicyDigest: env.PI_PLATFORM_POLICY_DIGEST }
      : {}),
    ...(env.PI_RESOURCE_DIGEST ? { resourceDigest: env.PI_RESOURCE_DIGEST } : {}),
    brainControlUrl: env.BRAIN_CONTROL_URL ?? "http://brain-control:3000"
  });
}

function parseToolAllowlist(value: string): string[] {
  return value
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean);
}

export function loadMediaWorkerRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): z.infer<typeof ServicePortConfigSchema> {
  return loadServicePortConfig(env.MEDIA_WORKER_PORT, 3030);
}

export const MatrixGatewayRuntimeConfigSchema = z.object({
  port: portNumber,
  controlBaseUrl: httpUrl,
  homeserverUrl: httpUrl.optional(),
  outboundPollMs: positiveInteger,
  outboundClaimLimit: positiveInteger,
  e2eeRetryMs: positiveInteger,
  typingTimeoutMs: positiveInteger,
  typingRefreshMs: positiveInteger,
  typingMaxDurationMs: positiveInteger,
  maxMediaBytes: positiveInteger,
  syncPollMs: positiveInteger
});

export type MatrixGatewayRuntimeConfig = z.infer<typeof MatrixGatewayRuntimeConfigSchema>;

/** Loads Matrix Gateway operational settings and rejects invalid startup values. */
export function loadMatrixGatewayRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): MatrixGatewayRuntimeConfig {
  return MatrixGatewayRuntimeConfigSchema.parse({
    port: env.MATRIX_GATEWAY_PORT ?? "3020",
    controlBaseUrl: env.BRAIN_CONTROL_URL ?? "http://localhost:3000",
    homeserverUrl: env.MATRIX_HOMESERVER_URL,
    outboundPollMs: env.MATRIX_OUTBOUND_POLL_MS ?? "2000",
    outboundClaimLimit: env.MATRIX_OUTBOUND_CLAIM_LIMIT ?? "10",
    e2eeRetryMs: env.MATRIX_E2EE_RETRY_MS ?? "5000",
    typingTimeoutMs: env.MATRIX_TYPING_TIMEOUT_MS ?? "30000",
    typingRefreshMs: env.MATRIX_TYPING_REFRESH_MS ?? "20000",
    typingMaxDurationMs: env.MATRIX_TYPING_MAX_DURATION_MS ?? "600000",
    maxMediaBytes: env.MATRIX_MAX_MEDIA_BYTES ?? "26214400",
    syncPollMs: env.MATRIX_SYNC_POLL_MS ?? "1000"
  });
}
