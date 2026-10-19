import type { InternalJobV1 } from "@second-brain/contracts";

import { TerminalWorkerError } from "./worker-errors.js";

export function requireStringJobPayload(job: InternalJobV1, key: string): string {
  const value = job.payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new TerminalWorkerError(`Job ${job.id} is missing payload.${key}.`);
  }
  return value;
}
