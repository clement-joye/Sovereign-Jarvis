import { z } from "zod";

import { AgentContributionV2Schema } from "./agent-contribution.js";
import {
  ApprovalPolicy,
  BrokerOperationV2Schema,
  ConfigurationSchema,
  LocalProviderRequirements
} from "./capabilities.js";
import {
  DefinitionDigest,
  Digest,
  Identifier,
  ModelSelection,
  ToolIdentifier
} from "./primitives.js";

export const CompiledPluginV2Schema = z
  .object({
    id: Identifier,
    displayName: z.string().min(1).max(120),
    contentDigest: Digest,
    activation: z.enum(["built-in", "workspace"]),
    agentIds: z.array(Identifier).max(64),
    credentialKind: Identifier.optional(),
    configurationSchema: ConfigurationSchema,
    operations: z
      .array(
        z
          .object({
            id: Identifier,
            toolName: ToolIdentifier,
            approvalPolicy: ApprovalPolicy
          })
          .strict()
      )
      .max(256)
  })
  .strict();
export type CompiledPluginV2 = z.infer<typeof CompiledPluginV2Schema>;

export const CompiledAgentV2Schema = AgentContributionV2Schema.extend({
  pluginId: Identifier,
  definitionDigest: DefinitionDigest
}).strict();
export type CompiledAgentV2 = z.infer<typeof CompiledAgentV2Schema>;

const CompiledCapabilityBaseV2Schema = z.object({
  capabilityId: Identifier,
  pluginId: Identifier,
  providerId: Identifier,
  implementationId: Identifier,
  definitionDigest: DefinitionDigest,
  toolIds: z.array(ToolIdentifier).min(1).max(64)
});

export const CompiledLocalCapabilityV2Schema = CompiledCapabilityBaseV2Schema.extend({
  providerKind: z.literal("local"),
  filesystem: LocalProviderRequirements.shape.filesystem,
  process: LocalProviderRequirements.shape.process,
  network: LocalProviderRequirements.shape.network,
  sideEffect: LocalProviderRequirements.shape.sideEffect
}).strict();
export type CompiledLocalCapabilityV2 = z.infer<typeof CompiledLocalCapabilityV2Schema>;

export const CompiledBrokerCapabilityV2Schema = CompiledCapabilityBaseV2Schema.extend({
  providerKind: z.literal("broker"),
  credentialKind: Identifier.optional(),
  configurationSchema: ConfigurationSchema,
  operations: z.array(BrokerOperationV2Schema).min(1).max(64)
})
  .strict()
  .superRefine((value, ctx) => {
    for (const operation of value.operations) {
      if (
        (operation.sideEffect === "external" || operation.sideEffect === "destructive") &&
        operation.approvalPolicy !== "owner"
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["operations"],
          message: `Compiled broker operation ${operation.id} requires owner approval.`
        });
      if (
        (operation.sideEffect === "external" || operation.sideEffect === "destructive") &&
        operation.idempotencyPolicy !== "required"
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["operations"],
          message: `Compiled broker operation ${operation.id} requires idempotency.`
        });
    }
  });
export type CompiledBrokerCapabilityV2 = z.infer<typeof CompiledBrokerCapabilityV2Schema>;

export const CompiledCapabilityProviderV2Schema = z.union([
  CompiledLocalCapabilityV2Schema,
  CompiledBrokerCapabilityV2Schema
]);
export type CompiledCapabilityProviderV2 = z.infer<typeof CompiledCapabilityProviderV2Schema>;

export const CompiledRuntimeFeatureV2Schema = z
  .object({ id: Identifier, pluginId: Identifier, definitionDigest: DefinitionDigest })
  .strict();
export type CompiledRuntimeFeatureV2 = z.infer<typeof CompiledRuntimeFeatureV2Schema>;

export const ReviewedModelV2Schema = ModelSelection;
export type ReviewedModelV2 = z.infer<typeof ReviewedModelV2Schema>;
