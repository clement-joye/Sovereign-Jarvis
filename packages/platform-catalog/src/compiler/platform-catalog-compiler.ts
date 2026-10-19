import {
  PlatformCatalogV2Schema,
  PluginManifestV2Schema,
  ReviewedModelV2Schema,
  RuntimeClassPinV2Schema,
  type PlatformCatalogV2,
  type PluginManifestV2,
  type ReviewedModelV2,
  type RuntimeClassPinV2
} from "@second-brain/contracts/platform-catalog";

import { validateAgentClosure } from "./agent-closure-validator.js";
import { compileCapabilities } from "./platform-capability-compiler.js";
import {
  byId,
  byPath,
  deepFreeze,
  digestBytes,
  digestValue,
  modelKey,
  policyProjectionDigest,
  resourceProjectionDigest,
  requireUnique
} from "./platform-catalog-digest.js";
import {
  agentResourceDigests,
  normalizePluginFiles,
  validatePluginResources
} from "./plugin-package-resources.js";

export {
  platformCatalogDigestV2,
  policyProjectionDigest,
  resourceProjectionDigest
} from "./platform-catalog-digest.js";

export interface PluginPackageV2 {
  manifest: PluginManifestV2;
  /** Package-relative immutable resources. The manifest itself is represented separately. */
  files: ReadonlyMap<string, string | Uint8Array>;
}

export interface PlatformCatalogCompilerInput {
  plugins: readonly PluginPackageV2[];
  runtimeClasses: readonly RuntimeClassPinV2[];
  reviewedModels: readonly ReviewedModelV2[];
  localToolFactoryIds: readonly string[];
  brokerProviderIds: readonly string[];
}

/** Compiles reviewed plugin packages into one closed, digest-addressed catalog. */
export function compilePlatformCatalogV2(
  input: PlatformCatalogCompilerInput
): Readonly<PlatformCatalogV2> {
  const plugins = input.plugins.map((plugin) => ({
    manifest: PluginManifestV2Schema.parse(plugin.manifest),
    files: normalizePluginFiles(plugin.files)
  }));
  requireUnique(
    plugins.map((plugin) => plugin.manifest.id),
    "plugin"
  );
  requireUnique(
    input.runtimeClasses.map((runtimeClass) => runtimeClass.id),
    "runtime class"
  );

  const runtimeClasses = input.runtimeClasses
    .map((runtimeClass) => RuntimeClassPinV2Schema.parse(runtimeClass))
    .sort(byId);
  const runtimeClassById = new Map(
    runtimeClasses.map((runtimeClass) => [runtimeClass.id, runtimeClass])
  );
  const reviewedModels = input.reviewedModels
    .map((model) => ReviewedModelV2Schema.parse(model))
    .sort((left, right) => modelKey(left).localeCompare(modelKey(right)));
  requireUnique(reviewedModels.map(modelKey), "reviewed model");
  const reviewedModelIds = new Set(reviewedModels.map(modelKey));
  const localToolFactoryIds = new Set(input.localToolFactoryIds);
  const brokerProviderIds = new Set(input.brokerProviderIds);

  const compiledPlugins = plugins.map((plugin) => compilePlugin(plugin)).sort(byId);

  const agents = plugins
    .flatMap((plugin) => {
      validatePluginResources(plugin.manifest, plugin.files);
      return plugin.manifest.agents.map((agent) => ({
        ...agent,
        pluginId: plugin.manifest.id,
        definitionDigest: digestValue({
          pluginId: plugin.manifest.id,
          agent,
          resources: agentResourceDigests(agent, plugin.files)
        })
      }));
    })
    .sort(byId);
  requireUnique(
    agents.map((agent) => agent.id),
    "agent"
  );

  const runtimeFeatures = plugins
    .flatMap((plugin) =>
      plugin.manifest.runtimeFeatures.map((feature) => ({
        ...feature,
        pluginId: plugin.manifest.id,
        definitionDigest: digestValue({ pluginId: plugin.manifest.id, feature })
      }))
    )
    .sort(byId);
  requireUnique(
    runtimeFeatures.map((feature) => feature.id),
    "runtime feature"
  );

  const capabilities = plugins
    .flatMap((plugin) =>
      compileCapabilities(plugin.manifest, localToolFactoryIds, brokerProviderIds)
    )
    .sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
  requireUnique(
    capabilities.map((capability) => capability.capabilityId),
    "capability"
  );
  requireUnique(
    capabilities.map((capability) => capability.providerId),
    "capability provider"
  );
  requireUnique(
    capabilities.flatMap((capability) => capability.toolIds),
    "tool"
  );
  requireUnique(
    capabilities.flatMap((capability) =>
      capability.providerKind === "broker"
        ? capability.operations.map((operation) => operation.id)
        : []
    ),
    "broker operation"
  );

  validateAgentClosure({
    agents,
    runtimeClassById,
    capabilities,
    runtimeFeatureIds: new Set(runtimeFeatures.map((feature) => feature.id)),
    reviewedModelIds
  });

  const content = {
    schemaVersion: 2 as const,
    runtimeClasses,
    plugins: compiledPlugins,
    agents,
    capabilities,
    runtimeFeatures,
    reviewedModels,
    policyDigest: platformPolicyDigestV2({
      runtimeClasses,
      plugins: compiledPlugins,
      agents,
      capabilities,
      runtimeFeatures,
      reviewedModels
    }),
    resourceDigest: resourceProjectionDigest(createRoleResourceFiles(plugins, agents))
  };
  const catalog = PlatformCatalogV2Schema.parse({ ...content, digest: digestValue(content) });
  return deepFreeze(catalog);
}

/**
 * Projects the parts of the catalog that affect authorization and runtime
 * policy. Content and definition digests are intentionally omitted: those are
 * integrity identities for the complete catalog, not policy inputs.
 */
export function platformPolicyDigestV2(input: {
  runtimeClasses: PlatformCatalogV2["runtimeClasses"];
  plugins: PlatformCatalogV2["plugins"];
  agents: PlatformCatalogV2["agents"];
  capabilities: PlatformCatalogV2["capabilities"];
  runtimeFeatures: PlatformCatalogV2["runtimeFeatures"];
  reviewedModels: PlatformCatalogV2["reviewedModels"];
}): string {
  const projection = {
    runtimeClasses: input.runtimeClasses.map(({ image: _image, ...runtimeClass }) => runtimeClass),
    plugins: input.plugins.map(
      ({ id, activation, credentialKind, configurationSchema, operations }) => ({
        id,
        activation,
        ...(credentialKind ? { credentialKind } : {}),
        configurationSchema,
        operations
      })
    ),
    agents: input.agents.map(({ definitionDigest: _definitionDigest, ...agent }) => agent),
    capabilities: input.capabilities.map(
      ({ definitionDigest: _definitionDigest, ...capability }) => capability
    ),
    runtimeFeatures: input.runtimeFeatures.map(({ id, pluginId }) => ({ id, pluginId })),
    reviewedModels: input.reviewedModels
  };
  return policyProjectionDigest(projection);
}

/** Selects only role prompts and skill files, in the same output namespace as
 * the host-local profile resource bundle. */
function createRoleResourceFiles(
  plugins: ReadonlyArray<{
    manifest: PluginManifestV2;
    files: ReadonlyMap<string, string | Uint8Array>;
  }>,
  agents: ReadonlyArray<PlatformCatalogV2["agents"][number]>
): ReadonlyMap<string, string | Uint8Array> {
  const agentsByPlugin = new Map<string, PlatformCatalogV2["agents"][number][]>();
  for (const agent of agents) {
    const pluginAgents = agentsByPlugin.get(agent.pluginId) ?? [];
    pluginAgents.push(agent);
    agentsByPlugin.set(agent.pluginId, pluginAgents);
  }

  const output = new Map<string, string | Uint8Array>();
  for (const plugin of plugins) {
    const selected = agentsByPlugin.get(plugin.manifest.id) ?? [];
    const roots = selected.flatMap((agent) => [agent.promptPath, ...agent.skillPaths]);
    for (const [path, content] of plugin.files) {
      if (!roots.some((root) => path === root || path.startsWith(`${root}/`))) continue;
      if (output.has(path)) {
        throw new Error(`Duplicate role resource output path: ${path}.`);
      }
      output.set(path, content);
    }
  }
  return output;
}

function compilePlugin(plugin: {
  manifest: PluginManifestV2;
  files: ReadonlyMap<string, string | Uint8Array>;
}): PlatformCatalogV2["plugins"][number] {
  const brokerConfiguration = plugin.manifest.brokerProviders.map(
    ({ configurationSchema }) => configurationSchema
  );
  const configurationSchema = Object.assign({}, ...brokerConfiguration) as Record<
    string,
    "string" | "boolean" | "integer"
  >;
  for (const [key, type] of Object.entries(configurationSchema)) {
    if (brokerConfiguration.some((schema) => schema[key] !== undefined && schema[key] !== type)) {
      throw new Error(`Plugin ${plugin.manifest.id} has conflicting configuration field ${key}.`);
    }
  }
  const credentialKinds = [
    ...new Set(
      plugin.manifest.brokerProviders.flatMap(({ credentialKind }) =>
        credentialKind ? [credentialKind] : []
      )
    )
  ];
  if (credentialKinds.length > 1) {
    throw new Error(`Plugin ${plugin.manifest.id} declares multiple credential kinds.`);
  }
  const localOperations = plugin.manifest.localToolProviders.flatMap(({ toolNames }) =>
    toolNames.map((toolName) => ({
      id: toolName.replaceAll("_", "-"),
      toolName,
      approvalPolicy: "none" as const
    }))
  );
  const brokerOperations = plugin.manifest.brokerProviders.flatMap(({ operations }) =>
    operations.map(({ id, toolName, approvalPolicy }) => ({ id, toolName, approvalPolicy }))
  );
  return {
    id: plugin.manifest.id,
    displayName: plugin.manifest.displayName,
    activation: plugin.manifest.activation,
    contentDigest: digestValue({
      manifest: plugin.manifest,
      resources: [...plugin.files.entries()]
        .map(([path, content]) => ({ path, digest: digestBytes(content) }))
        .sort(byPath)
    }),
    agentIds: plugin.manifest.agents.map(({ id }) => id).sort(),
    ...(credentialKinds[0] ? { credentialKind: credentialKinds[0] } : {}),
    configurationSchema,
    operations: [...localOperations, ...brokerOperations].sort((left, right) =>
      left.id.localeCompare(right.id)
    )
  };
}
