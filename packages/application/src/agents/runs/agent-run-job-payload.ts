import type { InternalJobV1 } from "@second-brain/contracts";

import { TerminalWorkerError } from "../../workers/worker-errors.js";

export function delegatedTools(job: InternalJobV1): string[] {
  const value = job.payload.allowedTools;
  if (!Array.isArray(value))
    throw new TerminalWorkerError("Agent run job has invalid allowedTools.");
  return value.map((tool) => {
    if (typeof tool !== "string") {
      throw new TerminalWorkerError("Agent run job has invalid allowedTools.");
    }
    return tool;
  });
}

export function delegatedPaths(
  job: InternalJobV1,
  name: "readablePaths" | "writablePaths"
): string[] {
  const value = job.payload[name];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((path) => typeof path !== "string")) {
    throw new TerminalWorkerError(`Agent run job has invalid ${name}.`);
  }
  return value as string[];
}

export function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
