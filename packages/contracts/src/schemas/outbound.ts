import { z } from "zod";

import { IsoTimestamp, NonEmptyString, OpaqueId, SchemaVersionV1 } from "./common.js";
import { StructuredErrorV1Schema } from "./errors.js";
import { AttachmentReferenceV1Schema } from "./media.js";

export const OutboundMessageV1Schema = z
  .object({
    schemaVersion: SchemaVersionV1,
    id: OpaqueId,
    traceId: OpaqueId,
    conversationId: OpaqueId,
    workspaceId: OpaqueId.optional(),
    text: z.string().min(1).optional(),
    audio: AttachmentReferenceV1Schema.optional(),
    images: z.array(AttachmentReferenceV1Schema),
    files: z.array(AttachmentReferenceV1Schema).optional(),
    replyToExternalEventId: OpaqueId.optional(),
    threadRootExternalEventId: OpaqueId.optional(),
    /** Semantic presentation controls transport rendering and history inclusion. */
    presentation: z.enum(["assistant", "notice", "error"]),
    urgency: z.enum(["normal", "important"]),
    idempotencyKey: NonEmptyString,
    /**
     * Optional text of a marker message that the gateway sends in the
     * same room immediately before the reply, so the reply becomes part
     * of that marker's thread. Used by scheduled jobs to keep every
     * session's reply inside its own room-level thread.
     */
    threadAnchorText: z.string().min(1).max(280).optional()
  })
  .superRefine((value, ctx) => {
    if (
      !value.text &&
      !value.audio &&
      value.images.length === 0 &&
      (value.files?.length ?? 0) === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Outbound messages require text, audio, images, or files."
      });
    }
  });
export type OutboundMessageV1 = z.infer<typeof OutboundMessageV1Schema>;

export const JobCompleteWithOutboundRequestV1Schema = z
  .object({ leaseOwner: OpaqueId, outbound: OutboundMessageV1Schema })
  .strict();
export type JobCompleteWithOutboundRequestV1 = z.infer<
  typeof JobCompleteWithOutboundRequestV1Schema
>;

export const DeliveryResultV1Schema = z.object({
  schemaVersion: SchemaVersionV1,
  outboundMessageId: OpaqueId,
  transport: z.literal("matrix"),
  externalEventId: OpaqueId.optional(),
  status: z.enum(["delivered", "retry_wait", "failed"]),
  error: StructuredErrorV1Schema.optional(),
  deliveredAt: IsoTimestamp.optional()
});
export type DeliveryResultV1 = z.infer<typeof DeliveryResultV1Schema>;

export const OutboundClaimRequestV1Schema = z
  .object({ limit: z.number().int().positive().optional() })
  .strict();
export type OutboundClaimRequestV1 = z.infer<typeof OutboundClaimRequestV1Schema>;

export const OutboundDeliveredRequestV1Schema = z.object({ externalEventId: OpaqueId }).strict();
export type OutboundDeliveredRequestV1 = z.infer<typeof OutboundDeliveredRequestV1Schema>;

export const OutboundAnchorDeliveredRequestV1Schema = z
  .object({
    anchorIdempotencyKey: NonEmptyString,
    anchorExternalEventId: OpaqueId,
    conversationId: OpaqueId
  })
  .strict();
export type OutboundAnchorDeliveredRequestV1 = z.infer<
  typeof OutboundAnchorDeliveredRequestV1Schema
>;

export const OutboundAnchorDeliveredResponseV1Schema = z.object({ ok: z.literal(true) }).strict();
export type OutboundAnchorDeliveredResponseV1 = z.infer<
  typeof OutboundAnchorDeliveredResponseV1Schema
>;

export const OutboundDeliveryFailureRequestV1Schema = z
  .object({ error: StructuredErrorV1Schema.optional() })
  .strict();
export type OutboundDeliveryFailureRequestV1 = z.infer<
  typeof OutboundDeliveryFailureRequestV1Schema
>;
