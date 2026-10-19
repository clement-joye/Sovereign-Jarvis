import type { IncomingMessage, ServerResponse } from "node:http";

import { PiRunRequestV1Schema, PiSessionCreateRequestV1Schema } from "@second-brain/contracts";
import {
  validatePiRequestExecutionIdentity,
  type PiExecutionIdentity
} from "@second-brain/pi-adapter";

import type { PiRunnerHttpService } from "./server.js";

type ReadJson = (request: IncomingMessage) => Promise<unknown>;
type WriteJson = (response: ServerResponse, statusCode: number, body: unknown) => void;

export interface PiRouteDependencies {
  service: PiRunnerHttpService;
  catalogDigest: string;
  executionIdentity?: PiExecutionIdentity;
  readJson: ReadJson;
  writeJson: WriteJson;
}

// handlePiRoute is a single-purpose action dispatcher that intentionally
// keeps all session/run/cancel branches together for readability. Each
// branch is a small request-validation plus a single pi-runner call;
// splitting them into per-action files would scatter a cohesive unit. The
// complexity threshold is advisory here — see eslint.config.js.
// eslint-disable-next-line complexity
export async function handlePiRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  dependencies: PiRouteDependencies
): Promise<boolean> {
  const method = request.method ?? "GET";
  const { readJson, service, writeJson } = dependencies;

  if (method === "POST" && url.pathname === "/v1/pi-runs") {
    const parsed = PiRunRequestV1Schema.safeParse(await readJson(request));
    if (!parsed.success) {
      writeJson(response, 400, { error: "invalid_pi_run_request", issues: parsed.error.issues });
      return true;
    }
    if (dependencies.executionIdentity) {
      try {
        validatePiRequestExecutionIdentity(parsed.data, dependencies.executionIdentity);
      } catch (error) {
        writeJson(response, 409, {
          error: "execution_identity_mismatch",
          detail: error instanceof Error ? error.message : "Invalid execution identity."
        });
        return true;
      }
    } else if (parsed.data.catalogDigest !== dependencies.catalogDigest) {
      writeJson(response, 409, {
        error: "catalog_digest_mismatch",
        expectedCatalogDigest: dependencies.catalogDigest
      });
      return true;
    }
    writeJson(response, 200, await service.run(parsed.data));
    return true;
  }

  if (method === "POST" && url.pathname === "/v1/pi-sessions") {
    const parsed = PiSessionCreateRequestV1Schema.safeParse(await readJson(request));
    if (!parsed.success) {
      writeJson(response, 400, {
        error: "invalid_pi_session_request",
        issues: parsed.error.issues
      });
      return true;
    }
    writeJson(response, 201, await service.createSession(parsed.data.sessionId));
    return true;
  }

  if (method === "POST" && url.pathname === "/v1/runtime-actions") {
    const body = await readJson(request);
    if (!isRuntimeActionRequest(body)) {
      writeJson(response, 400, { error: "invalid_runtime_action_request" });
      return true;
    }
    writeJson(response, 200, await service.runtimeAction(body.operationId, body.parameters));
    return true;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 4 || segments[0] !== "v1") return false;

  const [, resource, id, action] = segments;
  if (method === "POST" && resource === "pi-runs" && action === "cancel") {
    await service.cancel(id!);
    writeJson(response, 202, { cancelled: true, runId: id });
    return true;
  }
  if (method === "POST" && resource === "pi-sessions" && action === "cancel") {
    await service.cancelSession(id!);
    writeJson(response, 202, { cancelled: true, sessionId: id });
    return true;
  }
  if (method === "POST" && resource === "pi-sessions" && action === "close") {
    writeJson(response, 200, await service.closeSession(id!));
    return true;
  }
  if (method === "GET" && resource === "pi-sessions" && action === "health") {
    writeJson(response, 200, await service.sessionHealth(id!));
    return true;
  }

  return false;
}

function isRuntimeActionRequest(value: unknown): value is {
  operationId: string;
  parameters: Record<string, unknown>;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return (
    typeof input.operationId === "string" &&
    /^[a-z][a-z0-9-]{0,63}$/u.test(input.operationId) &&
    typeof input.parameters === "object" &&
    input.parameters !== null &&
    !Array.isArray(input.parameters)
  );
}
