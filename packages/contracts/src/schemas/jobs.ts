import { z } from "zod";

import { EffectiveRunPolicyV2Schema } from "../platform-catalog.js";
import { IsoTimestamp, NonEmptyString, OpaqueId, SchemaVersionV1 } from "./common.js";

export const InternalJobV1Schema = z.object({
  schemaVersion: SchemaVersionV1,
  id: OpaqueId,
  workspaceId: OpaqueId.optional(),
  type: z.enum([
    "process_inbound",
    "run_schedule",
    "run_agent",
    "progress_notice",
    "send_outbound",
    "transcribe_audio",
    "prepare_image",
    "synthesize_audio",
    "retention_cleanup"
  ]),
  payload: z.record(z.unknown()),
  priority: z.number().int(),
  status: z.enum([
    "pending",
    "leased",
    "running",
    "retry_wait",
    "completed",
    "dead_letter",
    "cancelled"
  ]),
  attempts: z.number().int().nonnegative(),
  availableAt: IsoTimestamp,
  leaseOwner: OpaqueId.optional(),
  leaseExpiresAt: IsoTimestamp.optional(),
  /** Ephemeral claim-time authority minted by the trusted control plane. */
  runAuthorization: NonEmptyString.optional(),
  /** Candidate per-agent snapshots; Router jobs may carry more than one. */
  effectiveRunPolicies: z.array(EffectiveRunPolicyV2Schema).max(128).optional(),
  idempotencyKey: NonEmptyString
});
export type InternalJobV1 = z.infer<typeof InternalJobV1Schema>;

export const JobClaimRequestV1Schema = z
  .object({
    workerId: OpaqueId,
    limit: z.number().int().positive().optional(),
    leaseMs: z.number().int().positive().optional(),
    jobTypes: z.array(InternalJobV1Schema.shape.type).min(1).max(16).optional()
  })
  .strict();
export type JobClaimRequestV1 = z.infer<typeof JobClaimRequestV1Schema>;

export const JobCompleteRequestV1Schema = z.object({ leaseOwner: OpaqueId }).strict();
export type JobCompleteRequestV1 = z.infer<typeof JobCompleteRequestV1Schema>;

export const JobHeartbeatRequestV1Schema = z
  .object({ leaseOwner: OpaqueId, leaseMs: z.number().int().positive() })
  .strict();
export type JobHeartbeatRequestV1 = z.infer<typeof JobHeartbeatRequestV1Schema>;

export const JobCompleteResponseV1Schema = z.object({ ok: z.literal(true) }).strict();
export type JobCompleteResponseV1 = z.infer<typeof JobCompleteResponseV1Schema>;

export const JobFailRequestV1Schema = z
  .object({
    leaseOwner: OpaqueId,
    retryable: z.boolean(),
    reason: NonEmptyString,
    retryDelayMs: z.number().int().nonnegative().optional(),
    maxAttempts: z.number().int().positive().optional()
  })
  .strict();
export type JobFailRequestV1 = z.infer<typeof JobFailRequestV1Schema>;
