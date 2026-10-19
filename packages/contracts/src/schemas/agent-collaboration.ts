import { z } from "zod";

import {
  AgentIdV1Schema,
  AgentToolIdentifier,
  IsoTimestamp,
  OpaqueId,
  PositiveBoundedInteger,
  RelativeResourcePath,
  SchemaVersionV1,
  Sha256Digest,
  TemplateVersion
} from "./common.js";
import { TokenBudgetSchema } from "../token-budget.js";

export const DelegationGrantV1Schema = z
  .object({
    schemaVersion: SchemaVersionV1,
    id: OpaqueId,
    parentRunId: OpaqueId,
    workspaceId: OpaqueId,
    childAgentId: AgentIdV1Schema,
    allowedTools: z.array(AgentToolIdentifier).max(128),
    readablePaths: z.array(RelativeResourcePath).max(32),
    writablePaths: z.array(RelativeResourcePath).max(32),
    timeoutSeconds: PositiveBoundedInteger(3_600),
    tokenBudget: TokenBudgetSchema,
    expiresAt: IsoTimestamp
  })
  .strict();
export type DelegationGrantV1 = z.infer<typeof DelegationGrantV1Schema>;

export const PlannerDelegationSpecV1Schema = z
  .object({
    targetAgentId: AgentIdV1Schema,
    task: z.string().min(1).max(20_000),
    allowedTools: z.array(AgentToolIdentifier).max(128).default([]),
    readablePaths: z.array(RelativeResourcePath).max(32).default([]),
    writablePaths: z.array(RelativeResourcePath).max(32).default([])
  })
  .strict();
export type PlannerDelegationSpecV1 = z.infer<typeof PlannerDelegationSpecV1Schema>;

export const RouterDecisionV1Schema = z
  .object({
    primaryAgentId: AgentIdV1Schema,
    childTasks: z.array(z.object({ agentId: AgentIdV1Schema, task: z.string().min(1) }).strict()),
    confidence: z.number().min(0).max(1),
    confirmationRequirements: z.array(z.string()),
    reason: z.string().min(1)
  })
  .strict();

export const AgentRunNoticeOriginV1Schema = z
  .object({
    conversationId: OpaqueId,
    replyToExternalEventId: OpaqueId,
    threadRootExternalEventId: OpaqueId
  })
  .strict();
export type AgentRunNoticeOriginV1 = z.infer<typeof AgentRunNoticeOriginV1Schema>;
export type RouterDecisionV1 = z.infer<typeof RouterDecisionV1Schema>;

export const AgentRunV1Schema = z
  .object({
    schemaVersion: SchemaVersionV1,
    id: OpaqueId,
    workspaceId: OpaqueId,
    agentId: AgentIdV1Schema,
    catalogVersion: TemplateVersion,
    catalogDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    // Optional so records created before durable execution identity was
    // introduced remain readable. New-run admission will require these later.
    effectivePolicyDigest: Sha256Digest.optional(),
    platformPolicyDigest: Sha256Digest.optional(),
    resourceDigest: Sha256Digest.optional(),
    runtimeImageId: z
      .string()
      .regex(/^(?:[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}|sha256:[a-f0-9]{64})$/)
      .optional(),
    status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
    rootRunId: OpaqueId,
    parentRunId: OpaqueId.optional(),
    delegationGrantId: OpaqueId.optional(),
    deadlineAt: IsoTimestamp,
    timeoutSeconds: PositiveBoundedInteger(3_600),
    tokenBudget: TokenBudgetSchema,
    createdAt: IsoTimestamp,
    startedAt: IsoTimestamp.optional(),
    completedAt: IsoTimestamp.optional(),
    resultText: z.string().max(100_000).optional(),
    noticeOrigin: AgentRunNoticeOriginV1Schema.optional()
  })
  .strict()
  .superRefine((run, ctx) => {
    if (!run.parentRunId && run.rootRunId !== run.id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rootRunId"],
        message: "A root agent run must use its own ID as rootRunId."
      });
    }
  });
export type AgentRunV1 = z.infer<typeof AgentRunV1Schema>;

export const AgentArtifactV1Schema = z
  .object({
    schemaVersion: SchemaVersionV1,
    id: OpaqueId,
    workspaceId: OpaqueId,
    producingRunId: OpaqueId,
    parentRunId: OpaqueId.optional(),
    agentId: AgentIdV1Schema,
    catalogVersion: TemplateVersion,
    catalogDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    kind: z.enum(["analysis", "plan", "research", "draft", "evidence"]),
    storageKey: RelativeResourcePath,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: IsoTimestamp
  })
  .strict();
export type AgentArtifactV1 = z.infer<typeof AgentArtifactV1Schema>;

/** A run-owned, renewable exclusive write lease for its workspace. */
export const WorkspaceWriteLeaseV1Schema = z
  .object({
    schemaVersion: SchemaVersionV1,
    id: OpaqueId,
    workspaceId: OpaqueId,
    ownerRunId: OpaqueId,
    acquiredAt: IsoTimestamp,
    expiresAt: IsoTimestamp
  })
  .strict();
export type WorkspaceWriteLeaseV1 = z.infer<typeof WorkspaceWriteLeaseV1Schema>;
