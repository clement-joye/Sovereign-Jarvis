import { readFile } from "node:fs/promises";

import {
  PlatformCatalogV2Schema,
  type CompiledCapabilityProviderV2,
  type PlatformCatalogV2,
  type RuntimeClassPinV2,
  type CompiledRuntimeFeatureV2
} from "@second-brain/contracts/platform-catalog";
import { emitSecurityEvent, type SecurityEventEmitter } from "@second-brain/observability";

import {
  platformCatalogDigestV2,
  platformPolicyDigestV2
} from "../compiler/platform-catalog-compiler.js";

export interface PlatformCatalogV2Reader {
  readonly catalog: Readonly<PlatformCatalogV2>;
  getAgent(id: string): PlatformCatalogV2["agents"][number] | undefined;
  getRuntimeClass(id: string): RuntimeClassPinV2 | undefined;
  getRuntimeFeature(id: string): CompiledRuntimeFeatureV2 | undefined;
  getCapability(capabilityId: string): CompiledCapabilityProviderV2 | undefined;
  getPlugin(id: string): PlatformCatalogV2["plugins"][number] | undefined;
}

/** Parse, validate, verify the content digest of, and freeze a serialized catalog artifact. */
export interface PlatformCatalogArtifactReadOptions {
  securityEvents?: SecurityEventEmitter;
}

export function parsePlatformCatalogV2Artifact(
  serialized: string,
  options: PlatformCatalogArtifactReadOptions = {}
): PlatformCatalogV2Reader {
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new Error("Invalid platform catalog JSON.", { cause: error });
  }

  const parsed = PlatformCatalogV2Schema.parse(value);
  const { digest, ...content } = parsed;
  const expectedDigest = platformCatalogDigestV2(content);
  if (digest !== expectedDigest) {
    emitSecurityEvent(options.securityEvents, {
      type: "catalog.mismatch",
      reason: "digest_mismatch",
      catalogDigest: digest
    });
    throw new Error(
      `Platform catalog digest mismatch: expected ${expectedDigest}, received ${digest}.`
    );
  }
  if (parsed.policyDigest && parsed.policyDigest !== platformPolicyDigestV2(parsed)) {
    emitSecurityEvent(options.securityEvents, {
      type: "catalog.mismatch",
      reason: "policy_digest_mismatch",
      catalogDigest: digest
    });
    throw new Error("Platform catalog policy digest does not match its policy projection.");
  }

  deepFreeze(parsed);
  return createReader(parsed);
}

/** Read a UTF-8 catalog from an operator-controlled immutable release path. */
export async function readPlatformCatalogV2Artifact(
  path: string | URL,
  options: PlatformCatalogArtifactReadOptions = {}
): Promise<PlatformCatalogV2Reader> {
  return parsePlatformCatalogV2Artifact(await readFile(path, "utf8"), options);
}

function createReader(catalog: PlatformCatalogV2): PlatformCatalogV2Reader {
  const agents = new Map(catalog.agents.map((agent) => [agent.id, agent]));
  const runtimeClasses = new Map(
    catalog.runtimeClasses.map((runtimeClass) => [runtimeClass.id, runtimeClass])
  );
  const runtimeFeatures = new Map(catalog.runtimeFeatures.map((feature) => [feature.id, feature]));
  const capabilities = new Map(
    catalog.capabilities.map((capability) => [capability.capabilityId, capability])
  );
  const plugins = new Map(catalog.plugins.map((plugin) => [plugin.id, plugin]));
  return Object.freeze({
    catalog,
    getAgent: (id: string) => agents.get(id),
    getRuntimeClass: (id: string) => runtimeClasses.get(id),
    getRuntimeFeature: (id: string) => runtimeFeatures.get(id),
    getCapability: (id: string) => capabilities.get(id),
    getPlugin: (id: string) => plugins.get(id)
  });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
