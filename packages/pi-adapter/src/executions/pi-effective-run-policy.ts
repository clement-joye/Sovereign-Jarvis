import { createHash } from "node:crypto";

import {
  EffectiveRunPolicyV2Schema,
  type CompiledAgentV2,
  type CompiledCapabilityProviderV2,
  type EffectiveRunPolicyV2,
  type PiRunRequestV1,
  type PlatformCatalogV2
} from "@second-brain/contracts";

/** The smallest catalog surface needed to validate a policy at the Pi boundary. */
export interface ReviewedPlatformCatalogReader {
  readonly catalog: Readonly<Pick<PlatformCatalogV2, "digest" | "policyDigest" | "resourceDigest">>;
  getAgent(id: string): CompiledAgentV2 | undefined;
  getCapability(id: string): CompiledCapabilityProviderV2 | undefined;
}

/** Identity observed by the process that will execute a Pi request. */
export interface PiExecutionIdentity {
  platformPolicyDigest: string;
  resourceDigest: string;
  runtimeImageId: string;
}

/** Validates only the immutable identities needed by an HTTP execution boundary. */
export function validatePiRequestExecutionIdentity(
  request: PiRunRequestV1,
  executionIdentity: PiExecutionIdentity
): EffectiveRunPolicyV2 {
  if (!request.effectiveRunPolicy)
    throw new Error("Pi request is missing an effective run policy.");
  const parsed = EffectiveRunPolicyV2Schema.parse(request.effectiveRunPolicy);
  validateRequestBinding(request, parsed);
  validateRuntimeExecutionIdentity(parsed, executionIdentity);
  return parsed;
}

/**
 * Validates the immutable policy attached to a Pi request against the active
 * reviewed catalog. Every check fails closed and the returned value is parsed.
 */
export function validatePiEffectiveRunPolicy(
  request: PiRunRequestV1,
  reviewedCatalog: ReviewedPlatformCatalogReader,
  executionIdentity?: PiExecutionIdentity
): EffectiveRunPolicyV2 {
  const policy = request.effectiveRunPolicy;
  if (!policy) throw new Error("Pi request is missing an effective run policy.");

  const parsed = EffectiveRunPolicyV2Schema.parse(policy);
  validateRequestBinding(request, parsed);
  validateCatalogExecutionIdentity(parsed, reviewedCatalog, executionIdentity);
  validateCanonicalCollections(parsed);
  const agent = requireReviewedAgent(parsed, reviewedCatalog);
  validateAgentResources(parsed, agent);
  const capabilities = requireReviewedCapabilities(parsed, agent, reviewedCatalog);
  validateEffectiveTools(parsed, capabilities);
  validateEffectivePlugins(parsed, agent, capabilities);
  validatePolicyDigest(parsed);
  return parsed;
}

function validateRequestBinding(request: PiRunRequestV1, parsed: EffectiveRunPolicyV2): void {
  const requestAgentId = request.agentId ?? parsed.agentId;
  if (request.catalogDigest !== undefined && request.catalogDigest !== parsed.catalogDigest) {
    throw new Error("Pi request catalog digest does not match the effective run policy.");
  }
  if (request.workspaceId !== parsed.workspaceId) {
    throw new Error("Effective run policy workspace does not match the Pi request.");
  }
  if (requestAgentId !== parsed.agentId) {
    throw new Error("Effective run policy agent does not match the Pi request.");
  }
}

/**
 * The catalog digest remains provenance: a prompt-only or other harmless
 * catalog change must not invalidate an already-authorized execution. The
 * policy/resource/image identities are the authority agreement instead.
 */
function validateCatalogExecutionIdentity(
  parsed: EffectiveRunPolicyV2,
  reviewedCatalog: ReviewedPlatformCatalogReader,
  executionIdentity: PiExecutionIdentity | undefined
): void {
  const platformPolicyDigest = reviewedCatalog.catalog.policyDigest;
  const resourceDigest = reviewedCatalog.catalog.resourceDigest;
  if (!platformPolicyDigest || !resourceDigest || !executionIdentity) {
    throw new Error("Pi runtime is missing an execution identity.");
  }
  if (parsed.platformPolicyDigest !== platformPolicyDigest) {
    throw new Error(
      "Effective run policy platform policy digest does not match the active policy."
    );
  }
  if (parsed.resourceDigest !== resourceDigest) {
    throw new Error("Effective run policy resource digest does not match the active resources.");
  }
  validateRuntimeExecutionIdentity(parsed, executionIdentity);
}

function validateRuntimeExecutionIdentity(
  parsed: EffectiveRunPolicyV2,
  executionIdentity: PiExecutionIdentity
): void {
  if (parsed.platformPolicyDigest !== executionIdentity.platformPolicyDigest)
    throw new Error("Effective run policy platform policy digest does not match the runtime.");
  if (parsed.resourceDigest !== executionIdentity.resourceDigest)
    throw new Error("Effective run policy resource digest does not match the runtime.");
  if (parsed.runtimeImageId !== executionIdentity.runtimeImageId)
    throw new Error("Effective run policy runtime image does not match the runtime.");
}

function validateCanonicalCollections(parsed: EffectiveRunPolicyV2): void {
  rejectDuplicates(parsed.pluginIds, "plugin");
  rejectDuplicates(parsed.capabilityIds, "capability");
  rejectDuplicates(parsed.toolIds, "tool");
  rejectDuplicates(parsed.skillPaths, "skill path");
  rejectDuplicates(parsed.extensionPaths, "extension path");
  requireSorted(parsed.pluginIds, "plugin");
  requireSorted(parsed.capabilityIds, "capability");
  requireSorted(parsed.toolIds, "tool");
  requireSorted(parsed.skillPaths, "skill path");
  requireSorted(parsed.extensionPaths, "extension path");
}

function requireReviewedAgent(
  parsed: EffectiveRunPolicyV2,
  reviewedCatalog: ReviewedPlatformCatalogReader
): CompiledAgentV2 {
  const agent = reviewedCatalog.getAgent(parsed.agentId);
  if (!agent) throw new Error(`Effective run policy agent is not reviewed: ${parsed.agentId}.`);
  return agent;
}

function validateAgentResources(parsed: EffectiveRunPolicyV2, agent: CompiledAgentV2): void {
  rejectDuplicates(agent.capabilityIds, "reviewed agent capability");
  rejectDuplicates(agent.skillPaths, "reviewed agent skill path");
  rejectDuplicates(agent.extensionPaths, "reviewed agent extension path");

  if (!sameSorted(parsed.skillPaths, agent.skillPaths)) {
    throw new Error("Effective run policy skill paths do not match the reviewed agent.");
  }
  if (!sameSorted(parsed.extensionPaths, agent.extensionPaths)) {
    throw new Error("Effective run policy extension paths do not match the reviewed agent.");
  }
}

function requireReviewedCapabilities(
  parsed: EffectiveRunPolicyV2,
  agent: CompiledAgentV2,
  reviewedCatalog: ReviewedPlatformCatalogReader
): CompiledCapabilityProviderV2[] {
  return parsed.capabilityIds.map((id) => {
    if (!agent.capabilityIds.includes(id)) {
      throw new Error(
        `Effective run policy capability is not granted by the reviewed agent: ${id}.`
      );
    }
    const capability = reviewedCatalog.getCapability(id);
    if (!capability) throw new Error(`Effective run policy capability is not reviewed: ${id}.`);
    return capability;
  });
}

function validateEffectiveTools(
  parsed: EffectiveRunPolicyV2,
  capabilities: CompiledCapabilityProviderV2[]
): void {
  const declaredTools = new Set(capabilities.flatMap((capability) => capability.toolIds));
  for (const capability of capabilities) {
    if (!capability.toolIds.some((toolId) => parsed.toolIds.includes(toolId))) {
      throw new Error(
        `Effective run policy capability has no effective tool: ${capability.capabilityId}.`
      );
    }
  }
  for (const toolId of parsed.toolIds) {
    if (!declaredTools.has(toolId)) {
      throw new Error(
        `Effective run policy tool is not declared by an included capability: ${toolId}.`
      );
    }
  }
}

function validateEffectivePlugins(
  parsed: EffectiveRunPolicyV2,
  agent: CompiledAgentV2,
  capabilities: CompiledCapabilityProviderV2[]
): void {
  const expectedPlugins = [
    ...new Set([agent.pluginId, ...capabilities.map((capability) => capability.pluginId)])
  ].sort();
  if (!same(parsed.pluginIds, expectedPlugins)) {
    throw new Error(
      "Effective run policy plugins do not match the reviewed agent and capabilities."
    );
  }
}

function validatePolicyDigest(parsed: EffectiveRunPolicyV2): void {
  const content = {
    schemaVersion: 2 as const,
    catalogDigest: parsed.catalogDigest,
    platformPolicyDigest: parsed.platformPolicyDigest,
    resourceDigest: parsed.resourceDigest,
    runtimeImageId: parsed.runtimeImageId,
    workspaceId: parsed.workspaceId,
    agentId: parsed.agentId,
    pluginIds: parsed.pluginIds,
    capabilityIds: parsed.capabilityIds,
    toolIds: parsed.toolIds,
    skillPaths: parsed.skillPaths,
    extensionPaths: parsed.extensionPaths
  };
  const expectedDigest = `sha256:${createHash("sha256").update(JSON.stringify(content)).digest("hex")}`;
  if (parsed.policyDigest !== expectedDigest) {
    throw new Error("Effective run policy digest is invalid.");
  }
}

function rejectDuplicates(values: readonly string[], kind: string): void {
  if (new Set(values).size !== values.length)
    throw new Error(`Duplicate ${kind} in effective run policy.`);
}

function requireSorted(values: readonly string[], kind: string): void {
  if (!same(values, [...values].sort())) {
    throw new Error(`Effective run policy ${kind} entries are not in canonical order.`);
  }
}

function same(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  );
}

function sameSorted(actual: readonly string[], expected: readonly string[]): boolean {
  return same(actual, [...expected].sort());
}
