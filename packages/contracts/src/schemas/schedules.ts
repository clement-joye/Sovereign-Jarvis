import { z } from "zod";
import {
  AgentIdV1Schema,
  IsoTimestamp,
  NonEmptyString,
  OpaqueId,
  SchemaVersionV1
} from "./common.js";
import { StructuredErrorV1Schema } from "./errors.js";

export const ScheduleDefinitionV1Schema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("once"), runAt: z.string().datetime({ offset: true }) }),
  z.object({ type: z.literal("cron"), expression: NonEmptyString, timezone: NonEmptyString }),
  z.object({
    type: z.literal("interval"),
    seconds: z.number().int().positive(),
    timezone: NonEmptyString
  })
]);
export type ScheduleDefinitionV1 = z.infer<typeof ScheduleDefinitionV1Schema>;

export const SessionPolicyV1Schema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fresh") }),
  z.object({ type: z.literal("dedicated") }),
  z.object({ type: z.literal("existing"), sessionId: OpaqueId })
]);
export type SessionPolicyV1 = z.infer<typeof SessionPolicyV1Schema>;

export const ScheduleCreateRequestV1Schema = z
  .object({
    workspaceId: OpaqueId.optional(),
    destinationConversationId: OpaqueId.optional(),
    destinationThreadRootExternalEventId: OpaqueId.optional(),
    agentId: AgentIdV1Schema.optional(),
    name: z.string().min(1).max(120),
    instruction: z.string().min(1).max(10_000),
    schedule: ScheduleDefinitionV1Schema,
    enabled: z.boolean().optional(),
    sessionPolicy: SessionPolicyV1Schema.optional(),
    notificationPolicy: z.enum(["always", "on_change", "on_failure", "never"]).optional(),
    overlapPolicy: z.enum(["skip", "queue"]).optional(),
    missedRunPolicy: z.enum(["skip", "run_once"]).optional(),
    timeoutSeconds: z.number().int().positive().max(86_400).optional()
  })
  .strict();
export type ScheduleCreateRequestV1 = z.infer<typeof ScheduleCreateRequestV1Schema>;

export const ScheduleUpdateRequestV1Schema = ScheduleCreateRequestV1Schema.omit({
  destinationThreadRootExternalEventId: true
})
  .partial()
  .extend({ expectedVersion: z.number().int().positive() })
  .strict();
export type ScheduleUpdateRequestV1 = z.infer<typeof ScheduleUpdateRequestV1Schema>;

export const ScheduleClaimDueRequestV1Schema = z
  .object({ limit: z.number().int().positive().optional() })
  .strict();
export const ScheduleDeleteRequestV1Schema = z
  .object({ expectedVersion: z.number().int().positive().optional() })
  .strict();
export const ScheduleVersionRequestV1Schema = z
  .object({ expectedVersion: z.number().int().positive() })
  .strict();
export const ScheduleRunRequestV1Schema = z.object({ requestId: OpaqueId.optional() }).strict();

export const RetentionRunRequestV1Schema = z
  .object({ dryRun: z.boolean().optional(), limit: z.number().int().positive().optional() })
  .strict();

export const ScheduledJobV1Schema = z.object({
  schemaVersion: SchemaVersionV1,
  id: OpaqueId,
  workspaceId: OpaqueId.optional(),
  destinationConversationId: OpaqueId.optional(),
  destinationThreadRootExternalEventId: OpaqueId.optional(),
  agentId: AgentIdV1Schema,
  name: NonEmptyString,
  instruction: NonEmptyString,
  schedule: ScheduleDefinitionV1Schema,
  enabled: z.boolean(),
  sessionPolicy: SessionPolicyV1Schema,
  notificationPolicy: z.enum(["always", "on_change", "on_failure", "never"]),
  overlapPolicy: z.enum(["skip", "queue"]),
  missedRunPolicy: z.enum(["skip", "run_once"]),
  timeoutSeconds: z.number().int().positive(),
  nextRunAt: IsoTimestamp.optional(),
  lastRunAt: IsoTimestamp.optional(),
  version: z.number().int().positive(),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp
});
export type ScheduledJobV1 = z.infer<typeof ScheduledJobV1Schema>;

export const SchedulePreviewV1Schema = z
  .object({
    nextRunAt: IsoTimestamp.optional(),
    occurrences: z.array(IsoTimestamp)
  })
  .strict();
export type SchedulePreviewV1 = z.infer<typeof SchedulePreviewV1Schema>;

export const ScheduleMutationResultV1Schema = z
  .object({
    schedule: ScheduledJobV1Schema,
    preview: SchedulePreviewV1Schema
  })
  .strict();
export type ScheduleMutationResultV1 = z.infer<typeof ScheduleMutationResultV1Schema>;

export const ScheduledExecutionV1Schema = z.object({
  schemaVersion: SchemaVersionV1,
  id: OpaqueId,
  scheduleId: OpaqueId,
  scheduledFor: IsoTimestamp,
  status: z.enum([
    "created",
    "queued",
    "running",
    "succeeded",
    "failed",
    "timed_out",
    "cancelled",
    "skipped"
  ]),
  attempt: z.number().int().nonnegative(),
  sessionId: OpaqueId.optional(),
  resultFingerprint: NonEmptyString.optional(),
  error: StructuredErrorV1Schema.optional(),
  createdAt: IsoTimestamp,
  startedAt: IsoTimestamp.optional(),
  finishedAt: IsoTimestamp.optional()
});
export type ScheduledExecutionV1 = z.infer<typeof ScheduledExecutionV1Schema>;
