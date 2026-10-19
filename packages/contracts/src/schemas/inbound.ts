import { z } from "zod";

import { AgentIdV1Schema, IsoTimestamp, OpaqueId, SchemaVersionV1 } from "./common.js";
import { AttachmentReferenceV1Schema } from "./media.js";

export const InboundMessageV1Schema = z
  .object({
    schemaVersion: SchemaVersionV1,
    id: OpaqueId,
    traceId: OpaqueId,
    transport: z.literal("matrix"),
    externalEventId: OpaqueId,
    conversationId: OpaqueId,
    /** Added by the trusted control-plane room resolver before persistence. */
    workspaceId: OpaqueId.optional(),
    /** Set only by trusted Matrix routing after resolving a room default or @prefix. */
    agentId: AgentIdV1Schema.optional(),
    senderId: OpaqueId,
    userTimezone: z.string().min(1).optional(),
    receivedAt: IsoTimestamp,
    kind: z.enum(["text", "image", "audio", "document", "command"]),
    text: z.string().min(1).optional(),
    attachments: z.array(AttachmentReferenceV1Schema),
    replyToExternalEventId: OpaqueId.optional(),
    threadRootExternalEventId: OpaqueId.optional(),
    replacesExternalEventId: OpaqueId.optional(),
    metadata: z.record(z.unknown())
  })
  .superRefine((value, ctx) => {
    if (!value.text && value.attachments.length === 0 && value.kind !== "command") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Inbound messages require text or attachments unless they are command-only events."
      });
    }
  });
export type InboundMessageV1 = z.infer<typeof InboundMessageV1Schema>;

export const InboundAudioTranscriptRequestV1Schema = z
  .object({
    workspaceId: OpaqueId,
    text: z.string().trim().min(1).max(100_000)
  })
  .strict();
export type InboundAudioTranscriptRequestV1 = z.infer<typeof InboundAudioTranscriptRequestV1Schema>;

/** A bounded, labelled Matrix-thread item supplied to an agent as context. */
export const ThreadHistoryItemV1Schema = z
  .object({
    sender: z.enum(["user", "jarvis"]),
    text: z.string().min(1),
    occurredAt: IsoTimestamp
  })
  .strict();
export type ThreadHistoryItemV1 = z.infer<typeof ThreadHistoryItemV1Schema>;

export const InboundAcceptanceResponseV1Schema = z
  .object({
    inboundMessageId: OpaqueId,
    duplicate: z.boolean(),
    jobId: OpaqueId
  })
  .strict();
export type InboundAcceptanceResponseV1 = z.infer<typeof InboundAcceptanceResponseV1Schema>;
