import { TerminalWorkerError } from "@second-brain/application";

import { HttpResponseError } from "./http/http-response-error.js";

export function mapMediaWorkerError(error: unknown): unknown {
  if (error instanceof HttpResponseError && error.statusCode >= 400 && error.statusCode < 500) {
    return new TerminalWorkerError(
      `Media worker rejected the attachment with HTTP ${error.statusCode}.`
    );
  }
  return error;
}
