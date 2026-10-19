import type { IncomingMessage, ServerResponse } from "node:http";

import type { BrokerOperationRegistry } from "@second-brain/application";

import type { RunAuthorizationService } from "../authorization/run-authorization.js";
import type { ApprovalPromptPublisher } from "../approvals/approval-prompt-publisher.js";

type ReadJson = (request: IncomingMessage) => Promise<unknown>;
type WriteJson = (response: ServerResponse, statusCode: number, body: unknown) => void;

export interface BrokerRouteDependencies {
  operations: BrokerOperationRegistry;
  runAuthorizations: RunAuthorizationService;
  approvalPrompts: Pick<ApprovalPromptPublisher, "publish">;
  readJson: ReadJson;
  writeJson: WriteJson;
}

/** One authenticated HTTP boundary for every immutable plugin broker provider. */
export async function handleBrokerRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  dependencies: BrokerRouteDependencies
): Promise<boolean> {
  if (request.method !== "POST" || url.pathname !== "/v1/broker/execute") return false;
  const bearer = bearerToken(request);
  if (!bearer) {
    dependencies.writeJson(response, 401, { error: "broker_unauthorized" });
    return true;
  }
  const workspaceId = request.headers["x-jarvis-workspace-id"];
  if (typeof workspaceId !== "string" || !workspaceId) {
    dependencies.writeJson(response, 400, { error: "invalid_workspace_scope" });
    return true;
  }
  const body = await dependencies.readJson(request);
  if (!isBrokerRequest(body)) {
    dependencies.writeJson(response, 400, { error: "invalid_broker_request" });
    return true;
  }

  let resolved: ReturnType<BrokerOperationRegistry["resolve"]>;
  try {
    resolved = dependencies.operations.resolve(body.pluginId, body.operationId);
  } catch {
    dependencies.writeJson(response, 404, { error: "broker_operation_unavailable" });
    return true;
  }
  const authorized = dependencies.runAuthorizations.verify(bearer, {
    workspaceId,
    agentId: body.agentId,
    requiredTool: resolved.operation.toolName
  });
  if (!authorized) {
    dependencies.writeJson(response, 401, { error: "broker_unauthorized" });
    return true;
  }

  const result = await dependencies.operations.request({
    workspaceId,
    agentId: body.agentId,
    runId: authorized.runId,
    pluginId: body.pluginId,
    operationId: body.operationId,
    idempotencyKey: body.idempotencyKey,
    expiresAt: authorized.expiresAt,
    parameters: body.parameters
  });
  if (result.outcome === "pending") await dependencies.approvalPrompts.publish(result.proposal);
  dependencies.writeJson(
    response,
    result.outcome === "pending" ? 202 : 200,
    result.outcome === "pending" ? result : result.result
  );
  return true;
}

function isBrokerRequest(value: unknown): value is {
  pluginId: string;
  operationId: string;
  agentId: string;
  idempotencyKey: string;
  parameters: Record<string, unknown>;
} {
  if (!isRecord(value)) return false;
  return (
    isIdentifier(value.pluginId) &&
    isIdentifier(value.operationId) &&
    isIdentifier(value.agentId) &&
    typeof value.idempotencyKey === "string" &&
    value.idempotencyKey.length > 0 &&
    value.idempotencyKey.length <= 512 &&
    isRecord(value.parameters)
  );
}

function bearerToken(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization;
  return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
