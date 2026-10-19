import { createHash } from "node:crypto";

import { ActionOperationV1Schema, type ActionOperationV1 } from "@second-brain/contracts";

import { ActionProposalValidationError } from "./action-proposal-errors.js";

const MAX_CANONICAL_PARAMETERS_BYTES = 64 * 1024;
const MAX_CANONICAL_DEPTH = 16;
const MAX_CONTAINER_ITEMS = 256;

/** Produces deterministic JSON for the bounded JSON values used in action proposals. */
export function canonicalJson(value: unknown): string {
  return canonicalize(value, 0, new WeakSet<object>());
}

/** Returns the canonical operation representation bound by an action digest. */
export function canonicalizeActionProposalOperation(input: {
  pluginId: string;
  operation: ActionOperationV1;
  parameters: Record<string, unknown>;
}): string {
  const canonical = canonicalJson({
    pluginId: input.pluginId,
    operation: ActionOperationV1Schema.parse(input.operation),
    parameters: input.parameters
  });
  if (Buffer.byteLength(canonical, "utf8") > MAX_CANONICAL_PARAMETERS_BYTES) {
    throw new ActionProposalValidationError(
      `Action proposal parameters exceed the ${MAX_CANONICAL_PARAMETERS_BYTES}-byte limit.`
    );
  }
  return canonical;
}

/** Computes the `sha256:<hex>` digest bound into `ActionProposalV1`. */
export function actionProposalOperationDigest(input: {
  pluginId: string;
  operation: ActionOperationV1;
  parameters: Record<string, unknown>;
}): string {
  return `sha256:${createHash("sha256")
    .update(canonicalizeActionProposalOperation(input), "utf8")
    .digest("hex")}`;
}

function canonicalize(value: unknown, depth: number, seen: WeakSet<object>): string {
  if (depth > MAX_CANONICAL_DEPTH) {
    throw new ActionProposalValidationError("Action proposal parameters are too deeply nested.");
  }
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return canonicalizeNumber(value);
  if (typeof value !== "object") {
    throw new ActionProposalValidationError(
      "Action proposal parameters must contain JSON values only."
    );
  }
  if (seen.has(value)) {
    throw new ActionProposalValidationError("Action proposal parameters contain a cycle.");
  }
  seen.add(value);
  const result = Array.isArray(value)
    ? canonicalizeArray(value, depth, seen)
    : canonicalizeObject(value as Record<string, unknown>, depth, seen);
  seen.delete(value);
  return result;
}

function canonicalizeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new ActionProposalValidationError(
      "Action proposal parameters contain a non-finite number."
    );
  }
  return Object.is(value, -0) ? "0" : JSON.stringify(value);
}

function canonicalizeArray(value: unknown[], depth: number, seen: WeakSet<object>): string {
  if (value.length > MAX_CONTAINER_ITEMS) {
    throw new ActionProposalValidationError("Action proposal parameter arrays are too large.");
  }
  return `[${value.map((item) => canonicalize(item, depth + 1, seen)).join(",")}]`;
}

function canonicalizeObject(
  record: Record<string, unknown>,
  depth: number,
  seen: WeakSet<object>
): string {
  const prototype = Reflect.getPrototypeOf(record);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ActionProposalValidationError(
      "Action proposal parameters must be plain JSON objects."
    );
  }
  const entries = Object.entries(record);
  if (entries.length > MAX_CONTAINER_ITEMS) {
    throw new ActionProposalValidationError("Action proposal parameter objects are too large.");
  }
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item, depth + 1, seen)}`)
    .join(",")}}`;
}
