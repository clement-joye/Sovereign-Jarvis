import type {
  CompiledCapabilityProviderV2,
  PluginManifestV2
} from "@second-brain/contracts/platform-catalog";

import { digestValue } from "./platform-catalog-digest.js";

export function compileCapabilities(
  manifest: PluginManifestV2,
  localToolFactoryIds: ReadonlySet<string>,
  brokerProviderIds: ReadonlySet<string>
): CompiledCapabilityProviderV2[] {
  const local: CompiledCapabilityProviderV2[] = manifest.localToolProviders.map((provider) => {
    if (!localToolFactoryIds.has(provider.factoryId)) {
      throw new Error(
        `Plugin ${manifest.id} references unknown local tool factory: ${provider.factoryId}.`
      );
    }
    return {
      capabilityId: provider.capabilityId,
      pluginId: manifest.id,
      providerId: provider.id,
      implementationId: provider.factoryId,
      definitionDigest: digestValue({ pluginId: manifest.id, provider }),
      providerKind: "local",
      toolIds: provider.toolNames,
      filesystem: provider.filesystem,
      process: provider.process,
      network: provider.network,
      sideEffect: provider.sideEffect
    };
  });
  const brokers: CompiledCapabilityProviderV2[] = manifest.brokerProviders.map((provider) => {
    if (!brokerProviderIds.has(provider.providerId)) {
      throw new Error(
        `Plugin ${manifest.id} references unknown broker provider: ${provider.providerId}.`
      );
    }
    return {
      capabilityId: provider.capabilityId,
      pluginId: manifest.id,
      providerId: provider.id,
      implementationId: provider.providerId,
      definitionDigest: digestValue({ pluginId: manifest.id, provider }),
      providerKind: "broker",
      toolIds: provider.operations.map((operation) => operation.toolName),
      ...(provider.credentialKind ? { credentialKind: provider.credentialKind } : {}),
      configurationSchema: provider.configurationSchema,
      operations: provider.operations
    };
  });
  return [...local, ...brokers];
}
