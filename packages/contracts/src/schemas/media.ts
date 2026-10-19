import { z } from "zod";
import { AgentIdV1Schema, NonEmptyString, OpaqueId, SchemaVersionV1 } from "./common.js";

export const AttachmentReferenceV1Schema = z.object({
  schemaVersion: SchemaVersionV1,
  id: OpaqueId,
  workspaceId: OpaqueId.optional(),
  agentId: AgentIdV1Schema.optional(),
  purpose: z.enum(["inbound", "prepared", "outbound"]),
  mediaType: NonEmptyString,
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  storageKey: NonEmptyString,
  originalFilename: NonEmptyString.optional(),
  durationMs: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional()
});
export type AttachmentReferenceV1 = z.infer<typeof AttachmentReferenceV1Schema>;

export const MediaTranscriptionResponseV1Schema = z
  .object({ text: z.string(), language: NonEmptyString.optional() })
  .strict();
export type MediaTranscriptionResponseV1 = z.infer<typeof MediaTranscriptionResponseV1Schema>;

export const MediaSpeechResponseV1Schema = z
  .object({ audio: AttachmentReferenceV1Schema })
  .strict();
export type MediaSpeechResponseV1 = z.infer<typeof MediaSpeechResponseV1Schema>;
