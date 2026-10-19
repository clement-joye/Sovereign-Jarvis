import { z } from "zod";

import {
  CompiledAgentV2Schema,
  CompiledCapabilityProviderV2Schema,
  CompiledPluginV2Schema,
  CompiledRuntimeFeatureV2Schema,
  ReviewedModelV2Schema
} from "./compiled.js";
import type { ReviewedModelV2 } from "./compiled.js";
import {
  Digest,
  Identifier,
  RelativeResourcePath,
  SchemaVersionV2,
  ToolIdentifier
} from "./primitives.js";
import { RuntimeClassPinV2Schema } from "./runtime-class.js";

const PlatformCatalogV2ObjectSchema = z
  .object({
    schemaVersion: SchemaVersionV2,
    digest: Digest,
    // These projections are emitted for every newly compiled catalog. They
    // remain optional at the wire boundary so older reviewed fixtures can be
    // read while releases migrate to the split identities.
    policyDigest: Digest.optional(),
    resourceDigest: Digest.optional(),
    runtimeClasses: z.array(RuntimeClassPinV2Schema).min(1).max(32),
    plugins: z.array(CompiledPluginV2Schema).min(1).max(128),
    agents: z.array(CompiledAgentV2Schema).min(1).max(128),
    capabilities: z.array(CompiledCapabilityProviderV2Schema).max(256),
    runtimeFeatures: z.array(CompiledRuntimeFeatureV2Schema).max(128),
    reviewedModels: z.array(ReviewedModelV2Schema).max(128)
  })
  .strict();
type PlatformCatalogV2Object = z.infer<typeof PlatformCatalogV2ObjectSchema>;
interface ValidationScope {
  kind: string;
  path: string;
  ctx: z.RefinementCtx;
}

/** Immutable, fully compiled platform output consumed by the control plane and runtimes. */
export const PlatformCatalogV2Schema = PlatformCatalogV2ObjectSchema.superRefine(
  validatePlatformCatalogClosure
);
export type PlatformCatalogV2 = z.infer<typeof PlatformCatalogV2Schema>;

/** Immutable capability/resource snapshot resolved for one concrete run. */
export const EffectiveRunPolicyV2Schema = z
  .object({
    schemaVersion: SchemaVersionV2,
    /** Full catalog provenance only; execution agreement uses the narrower identities below. */
    catalogDigest: Digest,
    platformPolicyDigest: Digest,
    resourceDigest: Digest,
    runtimeImageId: z
      .string()
      .regex(/^(?:[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}|sha256:[a-f0-9]{64})$/),
    /** Digest of this complete effective run-policy snapshot. */
    policyDigest: Digest,
    workspaceId: z.string().min(1),
    agentId: Identifier,
    pluginIds: z.array(Identifier).min(1).max(128),
    capabilityIds: z.array(Identifier).max(128),
    toolIds: z.array(ToolIdentifier).max(256),
    skillPaths: z.array(RelativeResourcePath).max(64),
    extensionPaths: z.array(RelativeResourcePath).max(64)
  })
  .strict();
export type EffectiveRunPolicyV2 = z.infer<typeof EffectiveRunPolicyV2Schema>;

function validatePlatformCatalogClosure(
  value: PlatformCatalogV2Object,
  ctx: z.RefinementCtx
): void {
  const pluginIds = uniqueIds(value.plugins, (plugin) => plugin.id, {
    kind: "plugin",
    path: "plugins",
    ctx
  });
  const runtimeIds = uniqueIds(value.runtimeClasses, (runtimeClass) => runtimeClass.id, {
    kind: "runtime class",
    path: "runtimeClasses",
    ctx
  });
  const featureIds = uniqueIds(value.runtimeFeatures, (feature) => feature.id, {
    kind: "runtime feature",
    path: "runtimeFeatures",
    ctx
  });
  validateRuntimeClassFeatures(value.runtimeClasses, featureIds, ctx);
  const capabilityIds = validateCompiledCapabilities(value.capabilities, pluginIds, ctx);
  uniqueIds(value.agents, (agent) => agent.id, { kind: "agent", path: "agents", ctx });
  validateAgentSelection(value.agents, ctx);
  validateOwnedDefinitions(value.runtimeFeatures, pluginIds, {
    kind: "feature",
    path: "runtimeFeatures",
    ctx
  });
  validateCompiledAgents(value, { pluginIds, runtimeIds, featureIds, capabilityIds }, ctx);
}

function validateAgentSelection(
  agents: PlatformCatalogV2Object["agents"],
  ctx: z.RefinementCtx
): void {
  const defaults = agents.filter((agent) => agent.defaultForWorkspace);
  if (defaults.length !== 1)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["agents"],
      message: `A compiled catalog requires exactly one default workspace agent; received ${defaults.length}.`
    });
  const routers = agents.filter((agent) => agent.routesInbound);
  if (routers.length > 1)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["agents"],
      message: `A compiled catalog allows at most one inbound router; received ${routers.length}.`
    });
}

function validateRuntimeClassFeatures(
  runtimeClasses: PlatformCatalogV2Object["runtimeClasses"],
  featureIds: ReadonlySet<string>,
  ctx: z.RefinementCtx
): void {
  for (const runtimeClass of runtimeClasses) {
    for (const featureId of runtimeClass.featureIds) {
      addUnknownReference(
        !featureIds.has(featureId),
        `runtime class feature: ${runtimeClass.id}/${featureId}`,
        ctx,
        "runtimeClasses"
      );
    }
  }
}

function validateCompiledCapabilities(
  capabilities: PlatformCatalogV2Object["capabilities"],
  pluginIds: ReadonlySet<string>,
  ctx: z.RefinementCtx
): ReadonlySet<string> {
  const capabilityIds = uniqueIds(capabilities, (capability) => capability.capabilityId, {
    kind: "capability",
    path: "capabilities",
    ctx
  });
  uniqueIds(
    capabilities.flatMap((capability) => capability.toolIds.map((id) => ({ id }))),
    (tool) => tool.id,
    { kind: "compiled tool", path: "capabilities", ctx }
  );
  validateOwnedDefinitions(capabilities, pluginIds, {
    kind: "capability",
    path: "capabilities",
    ctx
  });
  return capabilityIds;
}

function validateCompiledAgents(
  value: PlatformCatalogV2Object,
  ids: {
    pluginIds: ReadonlySet<string>;
    runtimeIds: ReadonlySet<string>;
    featureIds: ReadonlySet<string>;
    capabilityIds: ReadonlySet<string>;
  },
  ctx: z.RefinementCtx
): void {
  const reviewedModels = new Set(value.reviewedModels.map(modelKey));
  for (const agent of value.agents) {
    addUnknownReference(!ids.pluginIds.has(agent.pluginId), `agent plugin: ${agent.pluginId}`, ctx);
    addUnknownReference(
      !ids.runtimeIds.has(agent.runtimeClass),
      `agent runtime class: ${agent.runtimeClass}`,
      ctx
    );
    for (const id of agent.capabilityIds)
      addUnknownReference(!ids.capabilityIds.has(id), `agent capability: ${agent.id}/${id}`, ctx);
    for (const id of agent.runtimeFeatureIds)
      addUnknownReference(!ids.featureIds.has(id), `agent runtime feature: ${agent.id}/${id}`, ctx);
    addUnknownReference(
      Boolean(agent.model && !reviewedModels.has(modelKey(agent.model))),
      `agent model: ${agent.id}`,
      ctx
    );
  }
}

function validateOwnedDefinitions<T extends { pluginId: string }>(
  definitions: readonly T[],
  pluginIds: ReadonlySet<string>,
  scope: ValidationScope
): void {
  for (const definition of definitions) {
    if (!pluginIds.has(definition.pluginId))
      scope.ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [scope.path],
        message: `Unknown ${scope.kind} plugin: ${definition.pluginId}.`
      });
  }
}

function uniqueIds<T>(
  values: readonly T[],
  identifier: (value: T) => string,
  scope: ValidationScope
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const value of values) {
    const id = identifier(value);
    if (ids.has(id))
      scope.ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [scope.path],
        message: `Duplicate ${scope.kind} id: ${id}.`
      });
    ids.add(id);
  }
  return ids;
}

function addUnknownReference(
  condition: boolean,
  reference: string,
  ctx: z.RefinementCtx,
  path = "agents"
): void {
  if (condition)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [path],
      message: `Unknown ${reference}.`
    });
}

function modelKey(model: ReviewedModelV2): string {
  return `${model.providerId}\u0000${model.modelId}`;
}
