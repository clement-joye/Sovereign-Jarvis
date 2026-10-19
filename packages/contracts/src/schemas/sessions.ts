import { z } from "zod";
import {
  AgentIdV1Schema,
  AgentToolIdentifier,
  IsoTimestamp,
  NonEmptyString,
  OpaqueId,
  PositiveBoundedInteger,
  RelativeResourcePath,
  SchemaVersionV1
} from "./common.js";
import { TokenBudgetSchema } from "../token-budget.js";
import { EffectiveRunPolicyV2Schema } from "../platform-catalog.js";
import { AttachmentReferenceV1Schema } from "./media.js";
import { StructuredErrorV1Schema } from "./errors.js";
import { AgentRunNoticeOriginV1Schema } from "./agent-collaboration.js";

export const SourceReferenceV1Schema = z.object({
  schemaVersion: SchemaVersionV1,
  inboundMessageId: OpaqueId.optional(),
  externalEventId: OpaqueId.optional(),
  conversationId: OpaqueId.optional(),
  textExcerpt: z.string().max(500).optional(),
  attachmentIds: z.array(OpaqueId).default([])
});
export type SourceReferenceV1 = z.infer<typeof SourceReferenceV1Schema>;

export const SessionResolutionV1Schema = z.object({
  schemaVersion: SchemaVersionV1,
  sessionId: OpaqueId,
  mode: z.enum([
    "default-room",
    "thread",
    "explicit",
    "scheduled-fresh",
    "scheduled-dedicated",
    "scheduled-existing"
  ]),
  created: z.boolean(),
  expiresAt: IsoTimestamp,
  sourceConversationId: OpaqueId.optional(),
  sourceThreadRootId: OpaqueId.optional()
});
export type SessionResolutionV1 = z.infer<typeof SessionResolutionV1Schema>;

export const PiRunRequestV1Schema = z.object({
  schemaVersion: SchemaVersionV1,
  id: OpaqueId,
  catalogDigest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
  workspaceId: OpaqueId.optional(),
  agentId: AgentIdV1Schema.optional(),
  traceId: OpaqueId,
  sessionId: OpaqueId,
  inputText: z.string(),
  images: z.array(AttachmentReferenceV1Schema),
  /** Scoped inbound attachments available to the current Pi run only. */
  attachments: z.array(AttachmentReferenceV1Schema).optional(),
  sourceReferences: z.array(SourceReferenceV1Schema),
  /** Trusted destination used by control-plane notices produced during this run. */
  noticeOrigin: AgentRunNoticeOriginV1Schema.optional(),
  timeoutSeconds: z.number().int().positive(),
  /** Total model-token ceiling for this run, clamped again by the runtime catalog. */
  tokenBudget: TokenBudgetSchema.optional(),
  /** Total textual/file output ceiling for this run, clamped by the runtime class. */
  maxOutputBytes: PositiveBoundedInteger(10_000_000).optional(),
  priority: z.enum(["interactive", "background"]),
  /** Ephemeral sessions must not retain native Pi conversation state after the run. */
  sessionPersistence: z.enum(["persistent", "ephemeral"]).optional(),
  /**
   * Control-plane capability ceiling for a delegated child run. Runtime
   * policy may narrow this further, but must never expand it.
   */
  delegatedToolPolicy: z.array(AgentToolIdentifier).max(128).optional(),
  /** Control-plane-resolved immutable capability/resource snapshot for this run. */
  effectiveRunPolicy: EffectiveRunPolicyV2Schema.optional(),
  /** Ephemeral authorization for broker/model calls made during this run. */
  runAuthorization: NonEmptyString.optional(),
  /** Workspace roots readable by this delegated run. Empty denies workspace reads. */
  readablePaths: z.array(RelativeResourcePath).max(32).optional(),
  /** Workspace roots writable by this delegated run. Empty denies workspace writes. */
  writablePaths: z.array(RelativeResourcePath).max(32).optional(),
  userTimezone: z.string().min(1).optional()
});
export type PiRunRequestV1 = z.infer<typeof PiRunRequestV1Schema>;

export const PiSessionCreateRequestV1Schema = z.object({ sessionId: OpaqueId }).strict();
export type PiSessionCreateRequestV1 = z.infer<typeof PiSessionCreateRequestV1Schema>;

export const SessionBindingLookupRequestV1Schema = z
  .object({
    workspaceId: OpaqueId.optional(),
    agentId: AgentIdV1Schema.optional(),
    conversationId: OpaqueId,
    threadRootExternalEventId: OpaqueId.optional(),
    scheduleId: OpaqueId.optional()
  })
  .strict();
export type SessionBindingLookupRequestV1 = z.infer<typeof SessionBindingLookupRequestV1Schema>;

export const SessionBindingActivateRequestV1Schema = SessionBindingLookupRequestV1Schema.extend({
  sessionId: OpaqueId
}).strict();
export type SessionBindingActivateRequestV1 = z.infer<typeof SessionBindingActivateRequestV1Schema>;

const SessionTimestampV1 = z.string().datetime({ offset: true });

/** Valid lifecycle states a multi-workspace v2 workspace may occupy. */
export const WorkspaceStatusV1Schema = z.enum([
  "pending_invite",
  "configuring",
  "provisioning",
  "active",
  "archived",
  "closed",
  "failed"
]);
export type WorkspaceStatusV1 = z.infer<typeof WorkspaceStatusV1Schema>;

export const SessionRecordV1Schema = z
  .object({
    id: OpaqueId,
    workspaceId: OpaqueId.optional(),
    label: z.string().optional(),
    status: z.enum(["active", "idle", "closed", "expired", "purged"]),
    createdAt: SessionTimestampV1,
    lastActiveAt: SessionTimestampV1,
    idleExpiresAt: SessionTimestampV1,
    absoluteExpiresAt: SessionTimestampV1,
    piSessionKey: OpaqueId,
    sourceType: z.enum(["default-room", "thread", "scheduled"]),
    sourceConversationId: OpaqueId.optional(),
    sourceThreadRootId: OpaqueId.optional(),
    sourceScheduleId: OpaqueId.optional()
  })
  .strict();
export type SessionRecordV1 = z.infer<typeof SessionRecordV1Schema>;

export const SessionCreateRequestV1Schema = SessionRecordV1Schema;
export const SessionCreateAndBindRequestV1Schema = z
  .object({
    workspaceId: OpaqueId.optional(),
    agentId: AgentIdV1Schema.optional(),
    session: SessionRecordV1Schema,
    conversationId: OpaqueId,
    threadRootExternalEventId: OpaqueId.optional(),
    scheduleId: OpaqueId.optional()
  })
  .strict();
export type SessionCreateAndBindRequestV1 = z.infer<typeof SessionCreateAndBindRequestV1Schema>;

export const ConversationVoicePreferenceRequestV1Schema = z
  .object({
    workspaceId: OpaqueId.optional(),
    conversationId: OpaqueId,
    threadRootExternalEventId: OpaqueId.optional(),
    enabled: z.boolean().optional()
  })
  .strict();
export type ConversationVoicePreferenceRequestV1 = z.infer<
  typeof ConversationVoicePreferenceRequestV1Schema
>;

export const ConversationVoicePreferenceResponseV1Schema = z
  .object({ enabled: z.boolean() })
  .strict();
export type ConversationVoicePreferenceResponseV1 = z.infer<
  typeof ConversationVoicePreferenceResponseV1Schema
>;

export const ConversationSessionContextRequestV1Schema = z
  .object({
    workspaceId: OpaqueId.optional(),
    conversationId: OpaqueId,
    threadRootExternalEventId: OpaqueId.optional(),
    mode: z.literal("persistent").nullable().optional(),
    historyLimit: z.number().int().min(0).max(100).nullable().optional()
  })
  .strict();
export type ConversationSessionContextRequestV1 = z.infer<
  typeof ConversationSessionContextRequestV1Schema
>;

export const ConversationSessionContextResponseV1Schema = z
  .object({
    mode: z.literal("persistent").optional(),
    historyLimit: z.number().int().min(0).max(100).optional()
  })
  .strict();
export type ConversationSessionContextResponseV1 = z.infer<
  typeof ConversationSessionContextResponseV1Schema
>;

export const PiRunResultV1Schema = z.object({
  schemaVersion: SchemaVersionV1,
  id: OpaqueId,
  traceId: OpaqueId,
  sessionId: OpaqueId,
  status: z.enum(["completed", "cancelled", "failed", "timed_out"]),
  text: z.string().optional(),
  generatedFiles: z.array(AttachmentReferenceV1Schema),
  error: StructuredErrorV1Schema.optional(),
  startedAt: IsoTimestamp,
  finishedAt: IsoTimestamp
});
export type PiRunResultV1 = z.infer<typeof PiRunResultV1Schema>;

export const PiRunCancelResponseV1Schema = z
  .object({ cancelled: z.literal(true), runId: OpaqueId })
  .strict();
export type PiRunCancelResponseV1 = z.infer<typeof PiRunCancelResponseV1Schema>;

export const PiSessionCancelResponseV1Schema = z
  .object({ cancelled: z.literal(true), sessionId: OpaqueId })
  .strict();
export type PiSessionCancelResponseV1 = z.infer<typeof PiSessionCancelResponseV1Schema>;
