import { createHash } from "node:crypto";

import type { PlatformCatalogV2, ReviewedModelV2 } from "@second-brain/contracts/platform-catalog";

export function platformCatalogDigestV2(catalog: Omit<PlatformCatalogV2, "digest">): string {
  return digestValue(catalog);
}

export function digestBytes(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function digestValue(value: unknown): string {
  return digestBytes(stableJson(value));
}

/** Computes the digest used by the catalog's authorization/runtime policy projection. */
export function policyProjectionDigest(value: unknown): string {
  return digestValue(value);
}

/** Computes the digest used by the role prompt/skill resource bundle. */
export function resourceProjectionDigest(files: ReadonlyMap<string, string | Uint8Array>): string {
  const hash = createHash("sha256");
  for (const [path, content] of [...files.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    hash.update(path, "utf8");
    hash.update("\0", "utf8");
    hash.update(content);
    hash.update("\0", "utf8");
  }
  return `sha256:${hash.digest("hex")}`;
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function requireUnique(values: readonly string[], kind: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${kind} id: ${value}.`);
    seen.add(value);
  }
}

export function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id);
}

export function byPath(left: { path: string }, right: { path: string }): number {
  return left.path.localeCompare(right.path);
}

export function modelKey(model: ReviewedModelV2): string {
  return `${model.providerId}\u0000${model.modelId}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
