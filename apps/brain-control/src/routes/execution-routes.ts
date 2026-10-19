import type { IncomingMessage, ServerResponse } from "node:http";

import type { ExecutionRepositoryPort } from "@second-brain/application";
import { ScheduledExecutionV1Schema } from "@second-brain/contracts";

import { parseOpaquePathParameter } from "./path-parameters.js";

type ReadJson = (request: IncomingMessage) => Promise<unknown>;
type WriteJson = (response: ServerResponse, statusCode: number, body: unknown) => void;

export interface ExecutionRouteDependencies {
  executions: ExecutionRepositoryPort;
  readJson: ReadJson;
  writeJson: WriteJson;
}

export async function handleExecutionRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  dependencies: ExecutionRouteDependencies
): Promise<boolean> {
  const method = request.method ?? "GET";
  const { executions, readJson, writeJson } = dependencies;
  if (!url.pathname.startsWith("/v1/executions/")) return false;

  const id = parseOpaquePathParameter(url.pathname.slice("/v1/executions/".length));
  if (id === undefined) {
    writeJson(response, 400, { error: "invalid_path_parameter" });
    return true;
  }

  if (method === "GET") {
    const execution = await executions.get(id);
    writeJson(response, execution ? 200 : 404, execution ?? { error: "not_found" });
    return true;
  }

  if (method !== "PUT") return false;

  const parsed = ScheduledExecutionV1Schema.safeParse(await readJson(request));
  if (!parsed.success) {
    writeJson(response, 400, { error: "invalid_execution_update", issues: parsed.error.issues });
    return true;
  }
  if (parsed.data.id !== id) {
    writeJson(response, 400, { error: "execution_id_mismatch" });
    return true;
  }
  writeJson(response, 200, await executions.update(parsed.data));
  return true;
}
