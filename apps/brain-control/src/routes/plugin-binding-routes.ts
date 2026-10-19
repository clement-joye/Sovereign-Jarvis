import type { IncomingMessage, ServerResponse } from "node:http";

import type {
  ActionApprovalPolicyRepositoryPort,
  WorkspacePluginBindingRepositoryPort
} from "@second-brain/application";

import type { PluginCatalog } from "../catalog/plugin-catalog.js";

type ReadJson = (request: IncomingMessage) => Promise<unknown>;
type WriteJson = (response: ServerResponse, statusCode: number, body: unknown) => void;

export interface PluginBindingRouteDependencies {
  bindings: WorkspacePluginBindingRepositoryPort;
  catalog: Pick<PluginCatalog, "get">;
  /** Optional workspace policy store; required for the approval-policy sub-route. */
  approvalPolicies?: ActionApprovalPolicyRepositoryPort;
  adminToken?: string;
  readJson: ReadJson;
  writeJson: WriteJson;
  now: () => Date;
}

interface PluginRouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  dependencies: PluginBindingRouteDependencies;
  workspaceId: string;
  pluginId: string;
  manifest: NonNullable<ReturnType<PluginCatalog["get"]>>;
}

/** Internal operator API for non-secret workspace plugin enablement. */
export async function handlePluginBindingRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  dependencies: PluginBindingRouteDependencies
): Promise<boolean> {
  const route = parsePluginRoute(url.pathname);
  if (!route) return false;
  if (
    !dependencies.adminToken ||
    request.headers.authorization !== `Bearer ${dependencies.adminToken}`
  ) {
    dependencies.writeJson(response, 401, { error: "plugin_admin_unauthorized" });
    return true;
  }
  const manifest = dependencies.catalog.get(route.pluginId);
  if (!manifest) {
    dependencies.writeJson(response, 404, { error: "unknown_plugin" });
    return true;
  }
  if (manifest.activation === "built-in") {
    dependencies.writeJson(response, 409, { error: "built_in_plugin_binding_forbidden" });
    return true;
  }
  const context = {
    request,
    response,
    dependencies,
    workspaceId: route.workspaceId,
    pluginId: route.pluginId,
    manifest
  };
  return route.kind === "approval-policy"
    ? handleApprovalPolicy(context)
    : handlePluginBinding(context);
}

async function handlePluginBinding(context: PluginRouteContext): Promise<boolean> {
  const { request, response, dependencies, workspaceId, pluginId, manifest } = context;
  if (request.method === "GET") {
    dependencies.writeJson(
      response,
      200,
      (await dependencies.bindings.get(workspaceId, pluginId)) ?? null
    );
    return true;
  }
  if (request.method === "DELETE") {
    await dependencies.bindings.disable(workspaceId, pluginId);
    dependencies.writeJson(response, 204, undefined);
    return true;
  }
  if (request.method !== "PUT") return false;
  const body = await dependencies.readJson(request);
  if (
    !isBindingInput(
      body,
      manifest.agentIds,
      manifest.configurationSchema,
      manifest.credentialKind !== undefined
    )
  ) {
    dependencies.writeJson(response, 400, { error: "invalid_plugin_binding" });
    return true;
  }
  await dependencies.bindings.upsert({
    workspaceId,
    pluginId,
    pluginVersion: manifest.contentDigest,
    enabledAgents: body.enabledAgents,
    configuration: body.configuration,
    ...(body.credentialRef ? { credentialRef: body.credentialRef } : {}),
    updatedAt: dependencies.now()
  });
  dependencies.writeJson(response, 204, undefined);
  return true;
}

async function handleApprovalPolicy(context: PluginRouteContext): Promise<boolean> {
  const { request, response, dependencies, workspaceId, pluginId, manifest } = context;
  if (!dependencies.approvalPolicies) {
    dependencies.writeJson(response, 503, { error: "approval_policy_unavailable" });
    return true;
  }
  const operationIds = manifest.operations.map(({ id }) => id);
  const requiredByManifest = manifest.operations
    .filter(({ approvalPolicy }) => approvalPolicy === "owner")
    .map(({ id }) => id);
  if (request.method === "GET") {
    const ownerRequiredOperations = new Set(requiredByManifest);
    for (const operationId of operationIds) {
      const mode = await dependencies.approvalPolicies.getMode(workspaceId, pluginId, operationId);
      if (mode === "owner") ownerRequiredOperations.add(operationId);
    }
    dependencies.writeJson(response, 200, {
      ownerRequiredOperations: operationIds.filter((id) => ownerRequiredOperations.has(id))
    });
    return true;
  }
  if (request.method !== "PUT") return false;
  const body = await dependencies.readJson(request);
  if (!isApprovalPolicyInput(body, operationIds)) {
    dependencies.writeJson(response, 400, { error: "invalid_approval_policy" });
    return true;
  }
  const requiredByManifestSet = new Set(requiredByManifest);
  await dependencies.approvalPolicies.replaceOwnerRequiredOperations({
    workspaceId,
    pluginId,
    operationIds: body.ownerRequiredOperations.filter((id) => !requiredByManifestSet.has(id)),
    updatedAt: dependencies.now()
  });
  dependencies.writeJson(response, 204, undefined);
  return true;
}

function parsePluginRoute(
  pathname: string
): { workspaceId: string; pluginId: string; kind: "binding" | "approval-policy" } | undefined {
  const match = pathname.match(
    /^\/v1\/workspaces\/([A-Za-z0-9_-]+)\/plugins\/([a-z][a-z0-9-]{0,63})(\/approval-policy)?$/
  );
  if (!match?.[1] || !match[2]) return undefined;
  return {
    workspaceId: match[1],
    pluginId: match[2],
    kind: match[3] ? "approval-policy" : "binding"
  };
}

function isApprovalPolicyInput(
  value: unknown,
  operationIds: readonly string[]
): value is { ownerRequiredOperations: string[] } {
  if (typeof value !== "object" || value === null) return false;
  const input = value as Record<string, unknown>;
  if (
    !Array.isArray(input.ownerRequiredOperations) ||
    !input.ownerRequiredOperations.every((operation) => typeof operation === "string")
  ) {
    return false;
  }
  const operations = input.ownerRequiredOperations;
  return (
    new Set(operations).size === operations.length &&
    operations.every((operation) => operationIds.includes(operation))
  );
}

function isBindingInput(
  value: unknown,
  eligibleAgents: readonly string[],
  configurationSchema: Record<string, "string" | "boolean" | "integer">,
  credentialRequired: boolean
): value is {
  enabledAgents: string[];
  configuration: Record<string, unknown>;
  credentialRef?: string;
} {
  if (typeof value !== "object" || value === null) return false;
  const input = value as Record<string, unknown>;
  if (
    !Array.isArray(input.enabledAgents) ||
    input.enabledAgents.length === 0 ||
    !input.enabledAgents.every(
      (agent): agent is string => typeof agent === "string" && eligibleAgents.includes(agent)
    ) ||
    typeof input.configuration !== "object" ||
    input.configuration === null ||
    (input.credentialRef !== undefined &&
      (typeof input.credentialRef !== "string" || input.credentialRef.length === 0)) ||
    (credentialRequired &&
      (typeof input.credentialRef !== "string" || input.credentialRef.length === 0))
  ) {
    return false;
  }
  const configuration = input.configuration as Record<string, unknown>;
  return (
    Object.keys(configuration).every((key) => key in configurationSchema) &&
    Object.entries(configurationSchema).every(([key, type]) =>
      type === "integer" ? Number.isInteger(configuration[key]) : typeof configuration[key] === type
    )
  );
}
