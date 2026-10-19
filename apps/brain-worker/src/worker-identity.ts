import { randomUUID } from "node:crypto";

/**
 * Creates the process-specific identity used to own durable job leases.
 * `workerRole` is intentionally only a stable service label.
 */
export function createWorkerInstanceId(
  workerRole: string,
  createUniqueId: () => string = randomUUID
): string {
  return `${workerRole}-${createUniqueId()}`;
}
