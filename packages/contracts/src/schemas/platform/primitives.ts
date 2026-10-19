import { z } from "zod";

/** The v2 catalog is deliberately a different contract from the legacy v1 catalog. */
export const SchemaVersionV2 = z.literal(2);

export const Identifier = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const ToolIdentifier = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
export const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const DefinitionDigest = Digest;
export const RelativeResourcePath = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !value
        .split("/")
        .some((segment) => segment === "." || segment === ".." || segment.length === 0),
    "Resource paths must be non-empty relative paths without traversal."
  );
export const PositiveBoundedInteger = (maximum: number) => z.number().int().positive().max(maximum);
export const NonNegativeBoundedInteger = (maximum: number) =>
  z.number().int().nonnegative().max(maximum);

export const WorkspaceAccess = z.enum(["none", "read", "scoped-write", "write"]);
export const ThreadContextPolicy = z.enum(["fresh_session_with_thread_history", "reuse_session"]);
export const ModelSelection = z
  .object({ providerId: Identifier, modelId: z.string().min(1).max(256) })
  .strict();

export const DelegationPolicy = z
  .object({
    mayDelegateTo: z.array(Identifier).max(32),
    toolPolicyByAgent: z.record(Identifier, z.array(ToolIdentifier).max(128)),
    maxChildren: NonNegativeBoundedInteger(32)
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const agentId of value.mayDelegateTo) {
      if (!(agentId in value.toolPolicyByAgent))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing delegated tool policy for agent ${agentId}.`
        });
    }
    for (const agentId of Object.keys(value.toolPolicyByAgent)) {
      if (!value.mayDelegateTo.includes(agentId))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Delegated tool policy references a disallowed agent: ${agentId}.`
        });
    }
  });

/** Declarative hints consumed by the deterministic catalog router. */
export const AgentRoutingHint = z
  .object({
    keywords: z.array(z.string().min(1).max(64)).min(1).max(32),
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1).max(240),
    confirmationRequirements: z.array(z.string().min(1).max(240)).max(8)
  })
  .strict();
