import type { IncomingMessage, ServerResponse } from "node:http";

import type { PrivilegedBrokerRegistry } from "@second-brain/application";
import { PiRunRequestV1Schema } from "@second-brain/contracts";
import { readJsonBody, writeJsonBody } from "@second-brain/observability";
import {
  validatePiRequestExecutionIdentity,
  type PiExecutionIdentity,
  type RuntimeProvisionerService
} from "@second-brain/pi-adapter";

export interface RuntimeProvisionerServerDependencies {
  provisioner: RuntimeProvisionerService;
  token: string;
  catalogDigest: string;
  executionIdentity?: Omit<PiExecutionIdentity, "runtimeImageId">;
  brokerOperations?: PrivilegedBrokerRegistry;
}

type RuntimeRouteHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  input: RuntimeProvisionerServerDependencies | undefined
) => Promise<boolean>;

const runtimeRouteHandlers: readonly RuntimeRouteHandler[] = [
  handleHealth,
  handleBrokerExecution,
  handleProvision,
  handleLifecycle,
  handlePiRun,
  handlePiCancellation,
  handleRuntimeHealth
];

export async function handleRuntimeRoute(
  request: IncomingMessage,
  response: ServerResponse,
  input?: RuntimeProvisionerServerDependencies
): Promise<void> {
  for (const handler of runtimeRouteHandlers) {
    if (await handler(request, response, input)) return;
  }
  writeJsonBody(response, 404, { error: "not_found" });
}

async function handleHealth(
  request: IncomingMessage,
  response: ServerResponse,
  input: RuntimeProvisionerServerDependencies | undefined
): Promise<boolean> {
  if (request.method !== "GET" || request.url !== "/health") return false;
  writeJsonBody(response, 200, {
    service: "runtime-provisioner",
    status: "live",
    ...(input ? { catalogDigest: input.catalogDigest } : {})
  });
  return true;
}

async function handleBrokerExecution(
  request: IncomingMessage,
  response: ServerResponse,
  input: RuntimeProvisionerServerDependencies | undefined
): Promise<boolean> {
  if (request.method !== "POST" || request.url !== "/v1/broker/execute" || !input) return false;
  if (!isAuthorized(request, input)) return writeUnauthorized(response);
  if (!input.brokerOperations) {
    writeJsonBody(response, 503, { error: "broker_unavailable" });
    return true;
  }
  const body = await readJsonBody(request);
  if (!isPrivilegedBrokerRequest(body)) {
    writeJsonBody(response, 400, { error: "invalid_broker_request" });
    return true;
  }
  writeJsonBody(
    response,
    200,
    await input.brokerOperations.execute(body.implementationId, {
      workspaceId: body.workspaceId,
      operationId: body.operationId,
      parameters: body.parameters
    })
  );
  return true;
}

async function handleProvision(
  request: IncomingMessage,
  response: ServerResponse,
  input: RuntimeProvisionerServerDependencies | undefined
): Promise<boolean> {
  if (request.method !== "POST" || request.url !== "/v1/runtimes/provision" || !input) return false;
  if (!isAuthorized(request, input)) return writeUnauthorized(response);
  const body = await readJsonBody(request);
  if (!isProvisionRequest(body)) {
    writeJsonBody(response, 400, { error: "invalid_provision_request" });
    return true;
  }
  const runtimeId = await input.provisioner.provisionReviewed(
    body.workspaceId,
    body.templateId,
    body.templateVersion
  );
  writeJsonBody(response, 201, { runtimeId });
  return true;
}

async function handleLifecycle(
  request: IncomingMessage,
  response: ServerResponse,
  input: RuntimeProvisionerServerDependencies | undefined
): Promise<boolean> {
  const match = request.url?.match(/^\/v1\/runtimes\/([A-Za-z0-9_-]+)\/(archive|destroy)$/);
  if (request.method !== "POST" || !match || !input) return false;
  if (!isAuthorized(request, input)) return writeUnauthorized(response);
  const [, workspaceId, operation] = match;
  if (!workspaceId || !operation) return writeInvalidRuntimeId(response);
  if (operation === "archive") await input.provisioner.archive(workspaceId);
  else await input.provisioner.destroy(workspaceId);
  writeJsonBody(response, 200, { ok: true });
  return true;
}

async function handlePiRun(
  request: IncomingMessage,
  response: ServerResponse,
  input: RuntimeProvisionerServerDependencies | undefined
): Promise<boolean> {
  const match = request.url?.match(/^\/v1\/runtimes\/([A-Za-z0-9_-]+)\/pi-runs$/);
  if (request.method !== "POST" || !match || !input) return false;
  if (!isAuthorized(request, input)) return writeUnauthorized(response);
  const workspaceId = match[1];
  if (!workspaceId) return writeInvalidRuntimeId(response);
  const body = await readJsonBody(request);
  const parsed = PiRunRequestV1Schema.safeParse({
    ...(typeof body === "object" && body !== null ? body : {}),
    workspaceId
  });
  if (!parsed.success) {
    writeJsonBody(response, 400, { error: "invalid_runtime_run_request" });
    return true;
  }
  if (input.executionIdentity) {
    const policy = parsed.data.effectiveRunPolicy;
    if (!policy) {
      writeJsonBody(response, 409, { error: "execution_identity_missing" });
      return true;
    }
    // Image agreement is checked by RuntimeProvisionerService after it has
    // resolved the request's reviewed runtime class.
    try {
      validatePiRequestExecutionIdentity(parsed.data, {
        ...input.executionIdentity,
        runtimeImageId: policy.runtimeImageId
      });
    } catch (error) {
      writeJsonBody(response, 409, {
        error: "execution_identity_mismatch",
        detail: error instanceof Error ? error.message : "Invalid execution identity."
      });
      return true;
    }
  } else if (parsed.data.catalogDigest !== input.catalogDigest) {
    writeJsonBody(response, 409, {
      error: "catalog_digest_mismatch",
      expectedCatalogDigest: input.catalogDigest
    });
    return true;
  }
  const { workspaceId: _ignored, ...runtimeRequest } = parsed.data;
  writeJsonBody(response, 200, await input.provisioner.run(workspaceId, runtimeRequest));
  return true;
}

async function handlePiCancellation(
  request: IncomingMessage,
  response: ServerResponse,
  input: RuntimeProvisionerServerDependencies | undefined
): Promise<boolean> {
  const match = request.url?.match(
    /^\/v1\/runtimes\/([A-Za-z0-9_-]+)\/pi-runs\/([A-Za-z0-9_-]+)\/cancel$/
  );
  if (request.method !== "POST" || !match || !input) return false;
  if (!isAuthorized(request, input)) return writeUnauthorized(response);
  const [, workspaceId, runId] = match;
  if (!workspaceId || !runId) return writeInvalidRuntimeId(response);
  await input.provisioner.cancel(workspaceId, runId);
  writeJsonBody(response, 202, { cancelled: true, runId });
  return true;
}

async function handleRuntimeHealth(
  request: IncomingMessage,
  response: ServerResponse,
  input: RuntimeProvisionerServerDependencies | undefined
): Promise<boolean> {
  const match = request.url?.match(/^\/v1\/runtimes\/([A-Za-z0-9_-]+)\/health$/);
  if (request.method !== "GET" || !match || !input) return false;
  if (!isAuthorized(request, input)) return writeUnauthorized(response);
  const workspaceId = match[1];
  if (!workspaceId) return writeInvalidRuntimeId(response);
  writeJsonBody(response, 200, { health: await input.provisioner.health(workspaceId) });
  return true;
}

function isAuthorized(
  request: IncomingMessage,
  input: RuntimeProvisionerServerDependencies
): boolean {
  return request.headers.authorization === `Bearer ${input.token}`;
}

function writeUnauthorized(response: ServerResponse): true {
  writeJsonBody(response, 401, { error: "unauthorized" });
  return true;
}

function writeInvalidRuntimeId(response: ServerResponse): true {
  writeJsonBody(response, 400, { error: "invalid_runtime_id" });
  return true;
}

function isProvisionRequest(
  value: unknown
): value is { workspaceId: string; templateId: string; templateVersion: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return [input.workspaceId, input.templateId, input.templateVersion].every(
    (field) => typeof field === "string" && field.length > 0
  );
}

function isPrivilegedBrokerRequest(value: unknown): value is {
  implementationId: string;
  workspaceId: string;
  operationId: string;
  parameters: Record<string, unknown>;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return (
    isIdentifier(input.implementationId) &&
    typeof input.workspaceId === "string" &&
    /^[A-Za-z0-9_-]+$/.test(input.workspaceId) &&
    isIdentifier(input.operationId) &&
    typeof input.parameters === "object" &&
    input.parameters !== null &&
    !Array.isArray(input.parameters)
  );
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value);
}
