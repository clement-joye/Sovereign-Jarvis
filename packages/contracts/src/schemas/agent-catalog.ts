import { z } from "zod";

import {
  AgentIdV1Schema,
  AgentToolIdentifier,
  NonEmptyString,
  PositiveBoundedInteger,
  RelativeResourcePath,
  SchemaVersionV1,
  TemplateIdentifier,
  TemplateVersion
} from "./common.js";
import { validateAgentCatalog } from "./agent-catalog-validation.js";
import { TokenBudgetSchema } from "../token-budget.js";

export const RuntimeClassDefinitionV1Schema = z
  .object({
    id: TemplateIdentifier,
    image: z.string().regex(/^(?:[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}|sha256:[a-f0-9]{64})$/),
    networkPolicy: z.enum(["none", "restricted", "browser-restricted"]),
    maxConcurrentRuns: PositiveBoundedInteger(32),
    timeoutSeconds: PositiveBoundedInteger(3_600),
    memoryMiB: PositiveBoundedInteger(65_536),
    cpuMillicores: PositiveBoundedInteger(64_000)
  })
  .strict();
export type RuntimeClassDefinitionV1 = z.infer<typeof RuntimeClassDefinitionV1Schema>;

export const ThreadContextPolicyV1Schema = z.enum([
  "fresh_session_with_thread_history",
  "reuse_session"
]);
export type ThreadContextPolicyV1 = z.infer<typeof ThreadContextPolicyV1Schema>;

export const AgentModelSelectionV1Schema = z
  .object({ providerId: TemplateIdentifier, modelId: NonEmptyString.max(256) })
  .strict();
export type AgentModelSelectionV1 = z.infer<typeof AgentModelSelectionV1Schema>;

const AgentRoutingHintV1Schema = z
  .object({
    keywords: z.array(z.string().min(1).max(64)).min(1).max(32),
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1).max(240),
    confirmationRequirements: z.array(z.string().min(1).max(240)).max(8)
  })
  .strict();

export const AgentDefinitionV1Schema = z
  .object({
    schemaVersion: SchemaVersionV1,
    id: AgentIdV1Schema,
    version: TemplateVersion,
    runtimeClass: TemplateIdentifier,
    promptPath: RelativeResourcePath,
    skillPaths: z.array(RelativeResourcePath).max(32),
    extensionPaths: z.array(RelativeResourcePath).max(32),
    toolPolicy: z.array(AgentToolIdentifier).max(128),
    networkPolicy: z.enum(["none", "restricted", "browser-restricted"]),
    workspaceAccess: z.enum(["none", "read", "scoped-write", "write"]),
    threadContextPolicy: ThreadContextPolicyV1Schema.optional(),
    defaultForWorkspace: z.boolean().optional(),
    routesInbound: z.boolean().optional(),
    routing: AgentRoutingHintV1Schema.optional(),
    model: AgentModelSelectionV1Schema.optional(),
    timeoutSeconds: PositiveBoundedInteger(3_600),
    tokenBudget: TokenBudgetSchema,
    maxConcurrentRunsPerWorkspace: PositiveBoundedInteger(16),
    delegation: z
      .object({
        mayDelegateTo: z.array(AgentIdV1Schema).max(16),
        toolPolicyByAgent: z.record(AgentIdV1Schema, z.array(AgentToolIdentifier).max(128)),
        maxChildren: z.number().int().min(0).max(16)
      })
      .strict()
      .optional()
  })
  .strict();
export type AgentDefinitionV1 = z.infer<typeof AgentDefinitionV1Schema>;

export const AgentCatalogV1Schema = z
  .object({
    schemaVersion: SchemaVersionV1,
    version: TemplateVersion,
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    runtimeClasses: z.array(RuntimeClassDefinitionV1Schema).min(1).max(16),
    agents: z.array(AgentDefinitionV1Schema).min(1).max(64)
  })
  .strict()
  .superRefine(validateAgentCatalog);
export type AgentCatalogV1 = z.infer<typeof AgentCatalogV1Schema>;
