import { createServer, type Server } from "node:http";

import {
  attachRequestId,
  jsonRequestErrorResponse,
  type StructuredLogger
} from "@second-brain/observability";

import { dispatchBrainControlRequest, type BrainControlDispatcher } from "./routes/dispatcher.js";

export interface BrainControlHttpServerOptions {
  readonly dispatcher: BrainControlDispatcher;
  readonly logger: StructuredLogger;
}

/** Creates the HTTP host around an already-composed dispatcher dependency set. */
export function createBrainControlHttpServer(options: BrainControlHttpServerOptions): Server {
  return createServer((request, response) => {
    attachRequestId(request, response);
    void dispatchBrainControlRequest(request, response, options.dispatcher).catch(
      (error: unknown) => {
        const requestError = jsonRequestErrorResponse(error);
        if (requestError) {
          options.dispatcher.writeJson(response, requestError.statusCode, requestError.body);
          return;
        }
        options.logger.error("brain-control request handler threw", {
          request_url: request.url,
          request_method: request.method,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
        options.dispatcher.writeJson(response, 500, {
          error: error instanceof Error ? error.message : "Unknown brain-control error."
        });
      }
    );
  });
}
