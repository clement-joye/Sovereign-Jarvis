import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { AttachmentReferenceV1 } from "@second-brain/contracts";
import {
  aggregateHealthStatus,
  attachRequestId,
  jsonRequestErrorResponse,
  readJsonBody,
  type StructuredLogger,
  writeJsonBody
} from "@second-brain/observability";

import { mediaErrorResponse } from "./media-error-response.js";
import { handleMediaRoute } from "./media-routes.js";

export interface MediaHttpProcessor {
  transcribeAudio(attachment: AttachmentReferenceV1): Promise<unknown>;
  prepareImage(attachment: AttachmentReferenceV1): Promise<unknown>;
  synthesizeAudio(input: { text: string; voiceId?: string }): Promise<unknown>;
}

export function createMediaServer(input: {
  processor: MediaHttpProcessor;
  stt: { provider: string; ready: boolean; availableSlots?: number; modelVersion?: string };
  tts: { provider: string; ready: boolean; modelVersion?: string };
  logger: StructuredLogger;
}): Server {
  return createServer((request, response) => {
    attachRequestId(request, response);
    void route(request, response, input).catch((error: unknown) => {
      const requestError = jsonRequestErrorResponse(error);
      if (requestError) {
        writeJsonBody(response, requestError.statusCode, requestError.body);
        return;
      }
      input.logger.error("media request failed", {
        error_code: isErrorWithCode(error) ? error.code : "media_request_error",
        cause: error instanceof Error ? error.message : "Unknown media processing error."
      });
      const mapped = mediaErrorResponse(error);
      writeJsonBody(response, mapped.statusCode, mapped.body);
    });
  });
}

function isErrorWithCode(error: unknown): error is Error & { code: string } {
  return error instanceof Error && typeof (error as Error & { code?: unknown }).code === "string";
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: Parameters<typeof createMediaServer>[0]
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://media-worker.local");

  if (method === "GET" && url.pathname === "/health") {
    const envelope = aggregateHealthStatus({
      service: "media-worker",
      checkedAt: new Date().toISOString(),
      version: "0.0.0",
      dependencies: [
        {
          name: `stt:${dependencies.stt.provider}`,
          status: dependencies.stt.ready ? "ready" : "unavailable",
          ...(dependencies.stt.ready ? {} : { failureKind: "dependency_unavailable" as const })
        },
        {
          name: `tts:${dependencies.tts.provider}`,
          status: dependencies.tts.ready ? "ready" : "unavailable",
          ...(dependencies.tts.ready ? {} : { failureKind: "dependency_unavailable" as const })
        }
      ]
    });
    const httpUnavailable = envelope.status === "unavailable" || envelope.status === "degraded";
    writeJsonBody(response, httpUnavailable ? 503 : 200, {
      ...envelope,
      stt: dependencies.stt,
      tts: dependencies.tts
    });
    return;
  }

  if (
    await handleMediaRoute(request, response, url, {
      processor: dependencies.processor,
      readJson: readJsonBody,
      writeJson: writeJsonBody
    })
  ) {
    return;
  }

  writeJsonBody(response, 404, { error: "not_found" });
}
