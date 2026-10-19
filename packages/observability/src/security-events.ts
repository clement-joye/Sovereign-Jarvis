import type { StructuredLogger } from "./index.js";

/**
 * Stable, low-cardinality names for security-relevant decisions. These are
 * deliberately separate from human log messages so operators can query them
 * without parsing error text.
 */
export const SECURITY_EVENT_TYPES = [
  "authorization.denied",
  "catalog.mismatch",
  "approval.consumed",
  "workspace_path.denied",
  "plugin.failure"
] as const;

export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

export interface SecurityEventV1 {
  schemaVersion: 1;
  type: SecurityEventType;
  occurredAt: string;
  /** A stable reason code, never an exception message or user-controlled value. */
  reason: string;
  workspaceId?: string;
  runId?: string;
  agentId?: string;
  pluginId?: string;
  operationId?: string;
  catalogDigest?: string;
}

/** A minimal port so security-sensitive code need not know about log sinks. */
export interface SecurityEventEmitter {
  emit(event: SecurityEventV1): void;
}

export type SecurityEventInput = Omit<SecurityEventV1, "schemaVersion" | "occurredAt"> & {
  occurredAt?: string;
};

/**
 * Builds an event from reviewed identifiers only. Callers must not pass raw
 * tokens, credentials, prompts, user text, absolute paths, or error messages.
 */
export function securityEvent(input: SecurityEventInput): SecurityEventV1 {
  return {
    schemaVersion: 1,
    type: input.type,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    reason: input.reason,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.pluginId ? { pluginId: input.pluginId } : {}),
    ...(input.operationId ? { operationId: input.operationId } : {}),
    ...(input.catalogDigest ? { catalogDigest: input.catalogDigest } : {})
  };
}

export function emitSecurityEvent(
  emitter: SecurityEventEmitter | undefined,
  input: SecurityEventInput
): void {
  emitter?.emit(securityEvent(input));
}

/** Writes the vocabulary as structured, redacted JSON using one predictable envelope. */
export function createSecurityEventEmitter(logger: StructuredLogger): SecurityEventEmitter {
  return {
    emit(event) {
      const scoped = logger.withContext({
        ...(event.workspaceId ? { workspace_id: event.workspaceId } : {})
      });
      const data = { security_event: event };
      if (event.type === "approval.consumed") scoped.info("security event", data);
      else scoped.warn("security event", data);
    }
  };
}
