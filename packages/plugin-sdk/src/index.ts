import {
  PluginManifestV2Schema,
  type PiRunRequestV1,
  type PluginManifestV2
} from "@second-brain/contracts";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AgentCatalog } from "@second-brain/domain";
import type {
  ActionProposalService,
  BrokerOperationHandler,
  PrivilegedBrokerHandler,
  ReviewedActionOperationRegistry,
  WorkspacePluginBindingRepositoryPort
} from "@second-brain/application";

export const PLUGIN_SDK_VERSION = "1.0.0";
export const PLUGIN_SDK_MAJOR_VERSION = 1;
export const PLUGIN_MANIFEST_SCHEMA_VERSION = 2;
export const PLUGIN_API_SCHEMA_REVISION = 1;

/**
 * The compatibility boundary supported by plugin SDK v1. Plugin packages do not
 * carry independent versions: they are source-locked and released with the
 * platform. These revisions let build/release tooling reject incompatible
 * source before it reaches a runtime.
 */
export const PLUGIN_SDK_COMPATIBILITY = deepFreeze({
  sdkMajorVersion: PLUGIN_SDK_MAJOR_VERSION,
  manifestSchemaVersion: PLUGIN_MANIFEST_SCHEMA_VERSION,
  pluginApiSchemaRevision: PLUGIN_API_SCHEMA_REVISION
});

export interface PluginCompatibilityInput {
  readonly sdkMajorVersion: number;
  readonly manifestSchemaVersion: number;
  readonly pluginApiSchemaRevision: number;
}

export function assertPluginSdkCompatibility(input: PluginCompatibilityInput): void {
  for (const [field, expected] of Object.entries(PLUGIN_SDK_COMPATIBILITY)) {
    const actual = input[field as keyof PluginCompatibilityInput];
    if (actual !== expected) {
      throw new Error(`Incompatible plugin ${field}: expected ${expected}, received ${actual}.`);
    }
  }
}

export interface PiToolProviderContext {
  request: PiRunRequestV1;
  workspaceRoot: string;
  brainControlUrl: string;
  attachmentRoot?: string;
  agentCatalog: AgentCatalog;
  scheduleToolEvents: string[];
}

export interface PiToolProvider {
  readonly implementationId: string;
  create(context: PiToolProviderContext): ToolDefinition[];
}
/** Platform services available to a plugin's control-plane broker implementation. */
export interface BrokerHandlerFactoryContext {
  readonly bindings: WorkspacePluginBindingRepositoryPort;
  readonly proposals: ActionProposalService;
  readonly operations: Pick<ReviewedActionOperationRegistry, "require">;
  readonly privilegedBroker: { readonly baseUrl: string; readonly token: string };
}
/** Generic host services available behind the privileged provisioner boundary. */
export interface PrivilegedHandlerFactoryContext {
  readonly configuration: Readonly<Record<string, unknown>>;
  resolveCredential(reference: string): Promise<string>;
  executeRuntimeAction(
    workspaceId: string,
    agentId: string,
    operationId: string,
    parameters: Record<string, unknown>
  ): Promise<unknown>;
}
export interface BrokerHandlerFactory {
  readonly implementationId: string;
  create(context: BrokerHandlerFactoryContext): BrokerOperationHandler;
}
export interface PrivilegedHandlerFactory {
  readonly implementationId: string;
  create(context: PrivilegedHandlerFactoryContext): PrivilegedBrokerHandler;
}
export interface PluginPackage {
  readonly manifest: Readonly<PluginManifestV2>;
  readonly piToolProviders: readonly PiToolProvider[];
  readonly brokerHandlerFactories: readonly BrokerHandlerFactory[];
  readonly privilegedHandlerFactories: readonly PrivilegedHandlerFactory[];
}
export function definePluginPackage(input: {
  manifest: PluginManifestV2;
  piToolProviders?: readonly PiToolProvider[];
  brokerHandlerFactories?: readonly BrokerHandlerFactory[];
  privilegedHandlerFactories?: readonly PrivilegedHandlerFactory[];
}): Readonly<PluginPackage> {
  const piToolProviders = Object.freeze([...(input.piToolProviders ?? [])]);
  const brokerHandlerFactories = Object.freeze([...(input.brokerHandlerFactories ?? [])]);
  const privilegedHandlerFactories = Object.freeze([...(input.privilegedHandlerFactories ?? [])]);
  assertPluginContract({
    manifest: input.manifest,
    providers: piToolProviders,
    brokerHandlerFactories,
    privilegedHandlerFactories
  });
  return deepFreeze({
    manifest: definePlugin(input.manifest),
    piToolProviders,
    brokerHandlerFactories,
    privilegedHandlerFactories
  });
}

export function definePlugin(manifest: PluginManifestV2): Readonly<PluginManifestV2> {
  return deepFreeze(PluginManifestV2Schema.parse(manifest));
}

export function definePiToolProvider(provider: PiToolProvider): Readonly<PiToolProvider> {
  if (!provider.implementationId || typeof provider.create !== "function")
    throw new Error("Invalid Pi tool provider.");
  return deepFreeze(provider);
}

export function assertPluginContract(input: {
  manifest: PluginManifestV2;
  providers?: readonly PiToolProvider[];
  brokerHandlerFactories?: readonly BrokerHandlerFactory[];
  privilegedHandlerFactories?: readonly PrivilegedHandlerFactory[];
}): void {
  const manifest = PluginManifestV2Schema.parse(input.manifest);
  const providers = input.providers ?? [];
  const ids = providers.map((provider) => provider.implementationId);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate provider implementation ID.");
  const declaredImplementationIds = new Set([
    ...manifest.localToolProviders.map((provider) => provider.factoryId),
    ...manifest.brokerProviders.map((provider) => provider.providerId)
  ]);
  for (const implementationId of ids) {
    if (!declaredImplementationIds.has(implementationId)) {
      throw new Error(`Undeclared provider implementation ID: ${implementationId}.`);
    }
  }
  const brokerIds = manifest.brokerProviders.map(({ providerId }) => providerId);
  assertFactoryClosure("broker", brokerIds, input.brokerHandlerFactories ?? []);
  assertFactoryClosure("privileged", brokerIds, input.privilegedHandlerFactories ?? []);
}

function assertFactoryClosure(
  kind: string,
  declaredIds: readonly string[],
  factories: readonly { implementationId: string }[]
): void {
  const ids = factories.map(({ implementationId }) => implementationId);
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${kind} handler factory ID.`);
  for (const id of ids) {
    if (!declaredIds.includes(id)) throw new Error(`Undeclared ${kind} handler factory ID: ${id}.`);
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
