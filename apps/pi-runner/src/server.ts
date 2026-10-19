import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { INTERNAL_API_VERSION, type PiRunRequestV1 } from "@second-brain/contracts";
import {
  attachRequestId,
  healthStatus,
  jsonRequestErrorResponse,
  readJsonBody,
  writeJsonBody
} from "@second-brain/observability";

import { handlePiRoute } from "./pi-routes.js";

export interface PiRunnerHttpService {
  run(request: PiRunRequestV1): Promise<unknown>;
  cancel(runId: string): Promise<void>;
  cancelSession(sessionId: string): Promise<void>;
  createSession(sessionId: string): Promise<unknown>;
  closeSession(sessionId: string): Promise<unknown>;
  sessionHealth(sessionId: string): Promise<unknown>;
  runtimeAction(operationId: string, parameters: Record<string, unknown>): Promise<unknown>;
}

export function createPiRunnerServer(input: {
  service: PiRunnerHttpService;
  serviceName: string;
  version: string;
  catalogDigest: string;
  policyDigest?: string;
  resourceDigest?: string;
  runtimeImageId?: string;
}): Server {
  return createServer((request, response) => {
    attachRequestId(request, response);
    void route(request, response, input).catch((error: unknown) => {
      const requestError = jsonRequestErrorResponse(error);
      if (requestError) {
        writeJsonBody(response, requestError.statusCode, requestError.body);
        return;
      }
      writeJsonBody(response, 500, {
        error: error instanceof Error ? error.message : "Unknown pi-runner error."
      });
    });
  });
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: Parameters<typeof createPiRunnerServer>[0]
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://pi-runner.local");

  if (method === "GET" && url.pathname === "/health") {
    writeJsonBody(
      response,
      200,
      healthStatus({
        service: dependencies.serviceName,
        status: "live",
        checkedAt: new Date().toISOString(),
        version: dependencies.version,
        apiVersion: INTERNAL_API_VERSION,
        catalogDigest: dependencies.catalogDigest,
        ...(dependencies.policyDigest ? { policyDigest: dependencies.policyDigest } : {}),
        ...(dependencies.resourceDigest ? { resourceDigest: dependencies.resourceDigest } : {}),
        ...(dependencies.runtimeImageId ? { runtimeImageId: dependencies.runtimeImageId } : {}),
        dependencies: []
      })
    );
    return;
  }

  if (
    await handlePiRoute(request, response, url, {
      service: dependencies.service,
      catalogDigest: dependencies.catalogDigest,
      ...(dependencies.policyDigest && dependencies.resourceDigest && dependencies.runtimeImageId
        ? {
            executionIdentity: {
              platformPolicyDigest: dependencies.policyDigest,
              resourceDigest: dependencies.resourceDigest,
              runtimeImageId: dependencies.runtimeImageId
            }
          }
        : {}),
      readJson: readJsonBody,
      writeJson: writeJsonBody
    })
  ) {
    return;
  }

  writeJsonBody(response, 404, { error: "not_found" });
}
