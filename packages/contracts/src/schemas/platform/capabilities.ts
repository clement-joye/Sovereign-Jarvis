import { z } from "zod";

import { Identifier, ToolIdentifier } from "./primitives.js";

export const ConfigurationValueType = z.enum(["string", "boolean", "integer"]);
export const ConfigurationKey = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,63}$/)
  .refine(
    (value) => !/(?:secret|password|credential|token|api[_-]?key)/i.test(value),
    "Configuration schemas cannot declare secret-valued fields."
  );
export const ConfigurationSchema = z
  .record(ConfigurationKey, ConfigurationValueType)
  .refine(
    (value) => Object.keys(value).length <= 64,
    "Configuration schemas cannot contain more than 64 fields."
  );

/** Requirements declared by an in-process provider. They are reviewed policy, not grants. */
export const LocalProviderRequirements = z
  .object({
    filesystem: z.enum(["none", "read-only", "workspace-scoped-write"]),
    process: z.enum(["none", "sandboxed", "arbitrary"]),
    network: z.enum(["none", "restricted"]),
    // External/destructive mutations must cross a privileged broker.
    sideEffect: z.enum(["none", "workspace"])
  })
  .strict();

export const LocalToolProviderV2Schema = z
  .object({
    id: Identifier,
    capabilityId: Identifier,
    factoryId: Identifier,
    toolNames: z.array(ToolIdentifier).min(1).max(64),
    filesystem: LocalProviderRequirements.shape.filesystem,
    process: LocalProviderRequirements.shape.process,
    network: LocalProviderRequirements.shape.network,
    sideEffect: LocalProviderRequirements.shape.sideEffect
  })
  .strict();
export type LocalToolProviderV2 = z.infer<typeof LocalToolProviderV2Schema>;

export const SideEffect = z.enum(["none", "workspace", "external", "destructive"]);
export const ApprovalPolicy = z.enum(["none", "owner"]);
export const IdempotencyPolicy = z.enum(["not-applicable", "optional", "required"]);

export const BrokerOperationV2Schema = z
  .object({
    id: Identifier,
    toolName: ToolIdentifier,
    sideEffect: SideEffect,
    approvalPolicy: ApprovalPolicy,
    idempotencyPolicy: IdempotencyPolicy
  })
  .strict();
export type BrokerOperationV2 = z.infer<typeof BrokerOperationV2Schema>;

/** A provider whose implementation and credentials remain in a privileged broker. */
export const BrokerProviderV2Schema = z
  .object({
    id: Identifier,
    capabilityId: Identifier,
    providerId: Identifier,
    credentialKind: Identifier.optional(),
    configurationSchema: ConfigurationSchema,
    operations: z.array(BrokerOperationV2Schema).min(1).max(64)
  })
  .strict()
  .superRefine((value, ctx) => {
    const operationIds = new Set<string>();
    const toolNames = new Set<string>();
    for (const operation of value.operations) {
      if (operationIds.has(operation.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["operations"],
          message: `Duplicate broker operation id: ${operation.id}.`
        });
      }
      operationIds.add(operation.id);
      if (toolNames.has(operation.toolName)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["operations"],
          message: `Duplicate broker tool name: ${operation.toolName}.`
        });
      }
      toolNames.add(operation.toolName);
      if (
        (operation.sideEffect === "external" || operation.sideEffect === "destructive") &&
        operation.approvalPolicy !== "owner"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["operations"],
          message: `Broker operation ${operation.id} requires owner approval.`
        });
      }
      if (
        (operation.sideEffect === "external" || operation.sideEffect === "destructive") &&
        operation.idempotencyPolicy !== "required"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["operations"],
          message: `Broker operation ${operation.id} requires idempotency.`
        });
      }
    }
  });
export type BrokerProviderV2 = z.infer<typeof BrokerProviderV2Schema>;

export const RuntimeFeatureV2Schema = z.object({ id: Identifier }).strict();
export type RuntimeFeatureV2 = z.infer<typeof RuntimeFeatureV2Schema>;
