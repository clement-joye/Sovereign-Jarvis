import { z } from "zod";

import {
  AgentRoutingHint,
  DelegationPolicy,
  Identifier,
  ModelSelection,
  PositiveBoundedInteger,
  RelativeResourcePath,
  ThreadContextPolicy,
  WorkspaceAccess
} from "./primitives.js";
import { TokenBudgetSchema } from "../../token-budget.js";

/** A role contributed by a plugin. It contains policy and resource references, never code or secrets. */
export const AgentContributionV2Schema = z
  .object({
    id: Identifier,
    runtimeClass: Identifier,
    promptPath: RelativeResourcePath,
    skillPaths: z.array(RelativeResourcePath).max(64),
    extensionPaths: z.array(RelativeResourcePath).max(64),
    capabilityIds: z.array(Identifier).max(128),
    runtimeFeatureIds: z.array(Identifier).max(64),
    workspaceAccess: WorkspaceAccess,
    threadContextPolicy: ThreadContextPolicy,
    /** Exactly one compiled agent is the stable workspace default. */
    defaultForWorkspace: z.boolean().optional(),
    /** At most one compiled agent delegates inbound selection to the catalog router. */
    routesInbound: z.boolean().optional(),
    routing: AgentRoutingHint.optional(),
    model: ModelSelection.optional(),
    timeoutSeconds: PositiveBoundedInteger(3_600),
    tokenBudget: TokenBudgetSchema,
    maxConcurrentRunsPerWorkspace: PositiveBoundedInteger(32),
    delegation: DelegationPolicy.optional()
  })
  .strict();
export type AgentContributionV2 = z.infer<typeof AgentContributionV2Schema>;
