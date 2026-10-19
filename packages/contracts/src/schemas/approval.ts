import { z } from "zod";
import {
  AgentIdV1Schema,
  IsoTimestamp,
  OpaqueId,
  SchemaVersionV1,
  Sha256Digest,
  TemplateIdentifier,
  TemplateVersion
} from "./common.js";

/** The reviewed minimum authorization required by a tool operation. */
export const ApprovalModeV1Schema = z.enum(["none", "owner"]);
export type ApprovalModeV1 = z.infer<typeof ApprovalModeV1Schema>;

/**
 * Declarative policy carried by a provider/tool operation. Runtime policy may
 * strengthen this floor, but must never lower it.
 */
export const ApprovalPolicyV1Schema = z
  .object({
    minimumMode: ApprovalModeV1Schema,
    userMayStrengthen: z.literal(true).default(true)
  })
  .strict();
export type ApprovalPolicyV1 = z.infer<typeof ApprovalPolicyV1Schema>;

/** Generic operation declaration consumed by the approval middleware. */
export const ActionOperationV1Schema = z
  .object({
    capabilityId: TemplateIdentifier,
    operationId: TemplateIdentifier,
    operationVersion: TemplateVersion,
    approvalPolicy: ApprovalPolicyV1Schema
  })
  .strict();
export type ActionOperationV1 = z.infer<typeof ActionOperationV1Schema>;

const ActionProposalStatusV1Schema = z.enum([
  "proposed",
  "approved",
  "rejected",
  "consumed",
  "expired",
  "cancelled"
]);
export type ActionProposalStatusV1 = z.infer<typeof ActionProposalStatusV1Schema>;

/** Exact, redacted operation submitted to the durable approval service. */
export const ActionProposalV1Schema = z
  .object({
    schemaVersion: SchemaVersionV1,
    id: OpaqueId,
    operationDigest: Sha256Digest,
    workspaceId: OpaqueId,
    agentId: AgentIdV1Schema,
    runId: OpaqueId,
    pluginId: TemplateIdentifier,
    capabilityId: TemplateIdentifier,
    operationId: TemplateIdentifier,
    operationVersion: TemplateVersion,
    summary: z.string().min(1).max(2_000),
    /** Canonical bounded parameters; secrets must never be placed here. */
    parameters: z.record(z.string(), z.unknown()),
    approvalMode: ApprovalModeV1Schema,
    requiredApprover: z.enum(["none", "owner"]),
    idempotencyKey: z.string().min(1).max(512),
    status: ActionProposalStatusV1Schema,
    createdAt: IsoTimestamp,
    expiresAt: IsoTimestamp
  })
  .strict()
  .superRefine((value, ctx) => {
    const expectedApprover = value.approvalMode === "owner" ? "owner" : "none";
    if (value.requiredApprover !== expectedApprover) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requiredApprover"],
        message: "Required approver must match the effective approval mode."
      });
    }
  });
export type ActionProposalV1 = z.infer<typeof ActionProposalV1Schema>;

/** Input used by a provider/tool to request a durable proposal. */
export const ActionProposalCreateRequestV1Schema = z
  .object({
    schemaVersion: SchemaVersionV1,
    workspaceId: OpaqueId,
    agentId: AgentIdV1Schema,
    runId: OpaqueId,
    pluginId: TemplateIdentifier,
    operation: ActionOperationV1Schema,
    operationDigest: Sha256Digest,
    summary: z.string().min(1).max(2_000),
    parameters: z.record(z.string(), z.unknown()),
    approvalMode: ApprovalModeV1Schema,
    idempotencyKey: z.string().min(1).max(512),
    expiresAt: IsoTimestamp
  })
  .strict();
export type ActionProposalCreateRequestV1 = z.infer<typeof ActionProposalCreateRequestV1Schema>;

/** Only a trusted owner/transport event can produce a positive decision. */
export const ActionApprovalDecisionV1Schema = z
  .object({
    schemaVersion: SchemaVersionV1,
    proposalId: OpaqueId,
    workspaceId: OpaqueId,
    ownerId: OpaqueId,
    decision: z.enum(["approve", "reject"]),
    decidedBy: z.literal("owner"),
    decidedAt: IsoTimestamp,
    externalEventId: OpaqueId,
    reason: z.string().max(2_000).optional()
  })
  .strict();
export type ActionApprovalDecisionV1 = z.infer<typeof ActionApprovalDecisionV1Schema>;

export const ActionProposalPendingV1Schema = z
  .object({
    schemaVersion: SchemaVersionV1,
    outcome: z.literal("pending"),
    proposal: ActionProposalV1Schema
  })
  .strict();
export type ActionProposalPendingV1 = z.infer<typeof ActionProposalPendingV1Schema>;

const ActionProposalTerminalOutcomeV1Schema = z
  .object({
    schemaVersion: SchemaVersionV1,
    proposalId: OpaqueId,
    outcome: z.enum(["rejected", "expired", "cancelled"]),
    message: z.string().min(1).max(2_000)
  })
  .strict();
export const ActionProposalRejectedV1Schema = ActionProposalTerminalOutcomeV1Schema.extend({
  outcome: z.literal("rejected")
}).strict();
export type ActionProposalRejectedV1 = z.infer<typeof ActionProposalRejectedV1Schema>;

export const ActionProposalExpiredV1Schema = ActionProposalTerminalOutcomeV1Schema.extend({
  outcome: z.literal("expired")
}).strict();
export type ActionProposalExpiredV1 = z.infer<typeof ActionProposalExpiredV1Schema>;

export const ActionProposalCancelledV1Schema = ActionProposalTerminalOutcomeV1Schema.extend({
  outcome: z.literal("cancelled")
}).strict();
export type ActionProposalCancelledV1 = z.infer<typeof ActionProposalCancelledV1Schema>;

export const ActionProposalConsumedV1Schema = z
  .object({
    schemaVersion: SchemaVersionV1,
    proposalId: OpaqueId,
    outcome: z.literal("consumed"),
    result: z.unknown()
  })
  .strict();
export type ActionProposalConsumedV1 = z.infer<typeof ActionProposalConsumedV1Schema>;

/** Structured result returned while waiting, or after a terminal decision. */
export const ActionProposalOutcomeV1Schema = z.discriminatedUnion("outcome", [
  ActionProposalPendingV1Schema,
  ActionProposalRejectedV1Schema,
  ActionProposalExpiredV1Schema,
  ActionProposalCancelledV1Schema,
  ActionProposalConsumedV1Schema
]);
export type ActionProposalOutcomeV1 = z.infer<typeof ActionProposalOutcomeV1Schema>;
