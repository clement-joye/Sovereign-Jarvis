import type { HealthStatusV1 } from "@second-brain/contracts";

export {
  SECURITY_EVENT_TYPES,
  createSecurityEventEmitter,
  emitSecurityEvent,
  securityEvent,
  type SecurityEventEmitter,
  type SecurityEventInput,
  type SecurityEventType,
  type SecurityEventV1
} from "./security-events.js";

export {
  attachRequestId,
  jsonRequestErrorResponse,
  JsonBodyTooLargeError,
  JsonContentTypeError,
  type JsonRequestErrorResponse,
  JSON_BODY_LIMIT_BYTES,
  REQUEST_ID_HEADER,
  readJsonBody,
  writeJsonBody
} from "./http-json.js";

export { pingHttpUrl } from "./readiness.js";

export interface LogContext {
  service: string;
  environment: string;
  trace_id?: string;
  workspace_id?: string;
  conversation_id?: string;
  matrix_event_id?: string;
  inbound_message_id?: string;
  job_id?: string;
  session_id?: string;
  pi_run_id?: string;
  schedule_id?: string;
  execution_id?: string;
  outbound_message_id?: string;
  error_code?: string;
}

export interface StructuredLogEvent extends LogContext {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  version: string;
  data?: unknown;
}

export interface StructuredLogger {
  log(level: StructuredLogEvent["level"], message: string, data?: unknown): void;
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  /**
   * Returns a child logger that automatically injects the supplied correlation
   * fields into every emitted log line. The parent logger is not mutated.
   * Use this once at the top of a request handler so `workspace_id`,
   * `trace_id`, and other context propagate without per-call repetition.
   */
  withContext(context: Partial<LogContext>): StructuredLogger;
}

export interface StructuredLoggerOptions {
  service: string;
  environment: string;
  version: string;
  write?: (level: StructuredLogEvent["level"], line: string) => void;
}

export function redactLogValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactLogValue(entry));
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  const redacted: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (/token|password|secret|prompt|transcript|messageText|text|memory|databaseUrl/i.test(key)) {
      redacted[key] = "[redacted]";
    } else {
      redacted[key] = redactLogValue(entry);
    }
  }

  return redacted;
}

export function structuredLogEvent(
  input: Omit<StructuredLogEvent, "timestamp" | "data"> & { data?: unknown; now?: Date }
): StructuredLogEvent {
  return {
    timestamp: (input.now ?? new Date()).toISOString(),
    level: input.level,
    message: input.message,
    service: input.service,
    environment: input.environment,
    version: input.version,
    ...(input.trace_id ? { trace_id: input.trace_id } : {}),
    ...(input.workspace_id ? { workspace_id: input.workspace_id } : {}),
    ...(input.conversation_id ? { conversation_id: input.conversation_id } : {}),
    ...(input.matrix_event_id ? { matrix_event_id: input.matrix_event_id } : {}),
    ...(input.inbound_message_id ? { inbound_message_id: input.inbound_message_id } : {}),
    ...(input.job_id ? { job_id: input.job_id } : {}),
    ...(input.session_id ? { session_id: input.session_id } : {}),
    ...(input.pi_run_id ? { pi_run_id: input.pi_run_id } : {}),
    ...(input.schedule_id ? { schedule_id: input.schedule_id } : {}),
    ...(input.execution_id ? { execution_id: input.execution_id } : {}),
    ...(input.outbound_message_id ? { outbound_message_id: input.outbound_message_id } : {}),
    ...(input.error_code ? { error_code: input.error_code } : {}),
    ...(input.data !== undefined ? { data: redactLogValue(input.data) } : {})
  };
}

/** Creates a consistently redacted JSON logger for executable entrypoints. */
export function createStructuredLogger(
  options: StructuredLoggerOptions,
  inheritedContext: Partial<LogContext> = {}
): StructuredLogger {
  const write = options.write ?? defaultLogWriter;
  const log = (level: StructuredLogEvent["level"], message: string, data?: unknown): void => {
    write(
      level,
      JSON.stringify(
        structuredLogEvent({
          service: options.service,
          environment: options.environment,
          version: options.version,
          level,
          message,
          ...inheritedContext,
          ...(data === undefined ? {} : { data })
        })
      )
    );
  };
  return {
    log,
    debug: (message, data) => log("debug", message, data),
    info: (message, data) => log("info", message, data),
    warn: (message, data) => log("warn", message, data),
    error: (message, data) => log("error", message, data),
    withContext: (context) => createStructuredLogger(options, { ...inheritedContext, ...context })
  };
}

function defaultLogWriter(level: StructuredLogEvent["level"], line: string): void {
  if (level === "error") console.error(line);
  else console.log(line);
}

export function healthStatus(input: Omit<HealthStatusV1, "schemaVersion">): HealthStatusV1 {
  return { schemaVersion: 1, ...input };
}

/**
 * Readiness policy:
 *
 * - `live` services have started and report no checked dependencies
 *   (process-alive only). These always respond with HTTP 200.
 * - Services with checked dependencies use {@link aggregateHealthStatus}.
 *   The overall status is derived from each dependency:
 *   - any `unavailable` → top-level `unavailable` (HTTP 503)
 *   - any `degraded`   → top-level `degraded`   (HTTP 503)
 *   - all `ready`      → top-level `ready`      (HTTP 200)
 *
 * Services that need to advertise strict dependency checks should populate
 * the `dependencies` array and call {@link aggregateHealthStatus}; services
 * without explicit checks continue to report `live`.
 */
export const READINESS_POLICY_DESCRIPTION =
  "live = no checked dependencies; ready/degraded/unavailable reflect aggregated dependency readiness.";

export function aggregateHealthStatus(input: {
  service: string;
  checkedAt: string;
  version: string;
  catalogDigest?: string;
  policyDigest?: string;
  apiVersion?: string;
  dependencies: HealthStatusV1["dependencies"];
}): HealthStatusV1 {
  const status = input.dependencies.some((dependency) => dependency.status === "unavailable")
    ? "unavailable"
    : input.dependencies.some((dependency) => dependency.status === "degraded")
      ? "degraded"
      : "ready";

  return healthStatus({
    service: input.service,
    status,
    checkedAt: input.checkedAt,
    version: input.version,
    ...(input.catalogDigest ? { catalogDigest: input.catalogDigest } : {}),
    ...(input.policyDigest ? { policyDigest: input.policyDigest } : {}),
    ...(input.apiVersion ? { apiVersion: input.apiVersion } : {}),
    dependencies: input.dependencies
  });
}
