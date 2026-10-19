import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { MatrixGatewayProcessResult } from "@second-brain/matrix-adapter";
import { HealthStatusV1Schema, INTERNAL_API_VERSION } from "@second-brain/contracts";
import {
  aggregateHealthStatus,
  attachRequestId,
  healthStatus,
  jsonRequestErrorResponse,
  readJsonBody,
  writeJsonBody
} from "@second-brain/observability";

export interface MatrixGatewayHttpProcessor {
  process(event: unknown): Promise<MatrixGatewayProcessResult>;
}

export function createMatrixGatewayServer(input: {
  processor: MatrixGatewayHttpProcessor;
  serviceName: string;
  version: string;
  catalogDigest: string;
  policyDigest?: string;
  controlBaseUrl?: string;
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
        error: error instanceof Error ? error.message : "Unknown matrix-gateway error."
      });
    });
  });
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: Parameters<typeof createMatrixGatewayServer>[0]
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://matrix-gateway.local");

  if (method === "GET" && url.pathname === "/health") {
    const upstream: {
      name: string;
      status: "ready" | "degraded" | "unavailable";
      detail?: string;
    }[] = [];
    if (dependencies.controlBaseUrl) {
      upstream.push(
        await inspectControlPlaneHealth(
          `${dependencies.controlBaseUrl.replace(/\/$/, "")}/health`,
          dependencies.policyDigest
        )
      );
    }
    const envelope =
      upstream.length > 0
        ? aggregateHealthStatus({
            service: dependencies.serviceName,
            checkedAt: new Date().toISOString(),
            version: dependencies.version,
            apiVersion: INTERNAL_API_VERSION,
            catalogDigest: dependencies.catalogDigest,
            ...(dependencies.policyDigest ? { policyDigest: dependencies.policyDigest } : {}),
            dependencies: upstream
          })
        : healthStatus({
            service: dependencies.serviceName,
            status: "live",
            checkedAt: new Date().toISOString(),
            version: dependencies.version,
            apiVersion: INTERNAL_API_VERSION,
            catalogDigest: dependencies.catalogDigest,
            ...(dependencies.policyDigest ? { policyDigest: dependencies.policyDigest } : {}),
            dependencies: []
          });
    const unavailable = envelope.status === "unavailable" || envelope.status === "degraded";
    writeJsonBody(response, unavailable ? 503 : 200, envelope);
    return;
  }

  if (method === "POST" && url.pathname === "/v1/matrix-events") {
    const result = await dependencies.processor.process(await readJsonBody(request));
    writeJsonBody(response, 202, result);
    return;
  }

  writeJsonBody(response, 404, { error: "not_found" });
}

async function inspectControlPlaneHealth(
  url: string,
  expectedPolicyDigest?: string,
  timeoutMs = 1_000
): Promise<{
  name: string;
  status: "ready" | "degraded" | "unavailable";
  failureKind?: "api_incompatible" | "policy_mismatch" | "dependency_unavailable";
  detail?: string;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    if (!response.ok) {
      return {
        name: "control-plane",
        status: "unavailable",
        failureKind: "dependency_unavailable",
        detail: `Health endpoint returned HTTP ${response.status}.`
      };
    }
    const health = HealthStatusV1Schema.safeParse(await response.json());
    if (!health.success) {
      return {
        name: "control-plane",
        status: "unavailable",
        failureKind: "api_incompatible",
        detail: "Health endpoint returned an invalid envelope."
      };
    }
    if (health.data.apiVersion !== INTERNAL_API_VERSION) {
      return {
        name: "control-plane",
        status: "degraded",
        failureKind: "api_incompatible",
        detail: health.data.apiVersion
          ? `Internal API version ${health.data.apiVersion} is incompatible.`
          : "Internal API version is missing."
      };
    }
    if (expectedPolicyDigest !== undefined && health.data.policyDigest !== expectedPolicyDigest) {
      return {
        name: "control-plane",
        status: "degraded",
        failureKind: "policy_mismatch",
        detail: health.data.policyDigest
          ? `Control-plane policy digest ${health.data.policyDigest} does not match ${expectedPolicyDigest}.`
          : "Control-plane policy digest is missing."
      };
    }
    return { name: "control-plane", status: "ready" };
  } catch {
    return {
      name: "control-plane",
      status: "unavailable",
      failureKind: "dependency_unavailable"
    };
  } finally {
    clearTimeout(timer);
  }
}
