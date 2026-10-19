import { BROWSER_PLUGIN } from "@second-brain/browser-plugin";
import { EXAMPLE_ECHO_PLUGIN } from "@second-brain/example-echo-plugin";
import { CORE_PLUGIN } from "@second-brain/core-agents-plugin";
import type {
  ActionProposalService,
  BrokerOperationHandler,
  PrivilegedBrokerHandler,
  ReviewedActionOperationRegistry,
  WorkspacePluginBindingRepositoryPort
} from "@second-brain/application";
import type { BrokerHandlerFactoryContext, PluginPackage } from "@second-brain/plugin-sdk";

/** Single immutable installation composition; platform consumers stay plugin-agnostic. */
export * from "./catalog.js";
export const INSTALLED_PLUGIN_PACKAGES: readonly PluginPackage[] = Object.freeze([
  CORE_PLUGIN,
  BROWSER_PLUGIN,
  EXAMPLE_ECHO_PLUGIN
]);
export const INSTALLED_PI_TOOL_PROVIDERS = Object.freeze(
  INSTALLED_PLUGIN_PACKAGES.flatMap(({ piToolProviders }) => piToolProviders)
);

export function createInstalledBrokerHandlers(input: {
  bindings: WorkspacePluginBindingRepositoryPort;
  proposals: ActionProposalService;
  operations: Pick<ReviewedActionOperationRegistry, "require">;
  privilegedBroker?: { baseUrl: string; token: string };
}): BrokerOperationHandler[] {
  if (!input.privilegedBroker) return [];
  const context: BrokerHandlerFactoryContext = {
    bindings: input.bindings,
    proposals: input.proposals,
    operations: input.operations,
    privilegedBroker: input.privilegedBroker
  };
  return INSTALLED_PLUGIN_PACKAGES.flatMap(({ brokerHandlerFactories }) =>
    brokerHandlerFactories.map((factory) => factory.create(context))
  );
}

export function createInstalledPrivilegedBrokerHandlers(input: {
  environment: NodeJS.ProcessEnv;
  executeRuntimeAction(
    workspaceId: string,
    agentId: string,
    operationId: string,
    parameters: Record<string, unknown>
  ): Promise<unknown>;
}): PrivilegedBrokerHandler[] {
  const { environment } = input;
  const configuration = parseObjectEnvironment(environment.JARVIS_PLUGIN_RUNTIME_CONFIG, {});
  const credentials = parseObjectEnvironment(environment.JARVIS_PLUGIN_CREDENTIALS, {});
  return INSTALLED_PLUGIN_PACKAGES.flatMap((plugin) => {
    const pluginConfiguration = configuration[plugin.manifest.id];
    const pluginCredentials = credentials[plugin.manifest.id];
    if (pluginConfiguration !== undefined && !isObject(pluginConfiguration)) {
      throw new Error(`Plugin runtime configuration must be an object: ${plugin.manifest.id}.`);
    }
    if (pluginCredentials !== undefined && !isObject(pluginCredentials)) {
      throw new Error(`Plugin credentials must be an object: ${plugin.manifest.id}.`);
    }
    return plugin.privilegedHandlerFactories.map((factory) =>
      factory.create({
        configuration: pluginConfiguration ?? {},
        resolveCredential: async (reference) =>
          credentialFromObject(pluginCredentials ?? {}, reference),
        executeRuntimeAction: (workspaceId, agentId, operationId, parameters) =>
          input.executeRuntimeAction(workspaceId, agentId, operationId, parameters)
      })
    );
  });
}

function credentialFromObject(credentials: Record<string, unknown>, reference: string): string {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(reference)) {
    throw new Error("Invalid credential reference.");
  }
  const credential = credentials[reference];
  if (typeof credential !== "string" || !credential) {
    throw new Error(`Plugin credential is unavailable: ${reference}`);
  }
  return credential;
}

function parseObjectEnvironment(
  value: string | undefined,
  fallback: Record<string, unknown>
): Record<string, unknown> {
  if (!value) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Plugin runtime environment must contain valid JSON.");
  }
  if (!isObject(parsed)) throw new Error("Plugin runtime environment must contain a JSON object.");
  return parsed;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
