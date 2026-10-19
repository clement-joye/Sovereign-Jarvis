import { createHmac, timingSafeEqual } from "node:crypto";

import { emitSecurityEvent, type SecurityEventEmitter } from "@second-brain/observability";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const RUNTIME_IMAGE_PATTERN = /^(?:[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}|sha256:[a-f0-9]{64})$/;
const MAX_TOKEN_AGE_MS = 60 * 60 * 1_000;

export interface RunAuthorizationClaims {
  schemaVersion: 1;
  jobId: string;
  runId: string;
  workspaceId: string;
  agentId?: string;
  catalogDigest: string;
  /** Immutable execution snapshots selected for this claim. */
  executionIdentities: RunExecutionIdentity[];
  leaseOwner: string;
  allowedTools: string[];
  expiresAt: string;
}

export interface RunExecutionIdentity {
  agentId: string;
  /** Tools authorized for this exact agent/policy tuple. */
  allowedTools: string[];
  /** Digest of the complete effective run-policy snapshot. */
  effectivePolicyDigest: string;
  /** Reviewed platform policy projection that produced the snapshot. */
  platformPolicyDigest: string;
  /** Resource bundle projection required by the selected runtime. */
  resourceDigest: string;
  /** Bare or named immutable OCI image digest. */
  runtimeImageId: string;
}

export interface RunAuthorizationExpectation {
  runId?: string;
  workspaceId?: string;
  agentId?: string;
  requiredTool?: string;
  effectivePolicyDigest?: string;
  platformPolicyDigest?: string;
  resourceDigest?: string;
  runtimeImageId?: string;
}

/**
 * Issues short-lived, claim-time authority without sharing the signing secret
 * with workers or model runtimes. The opaque token may travel with one Pi run;
 * it is never an ambient environment credential.
 */
export class RunAuthorizationService {
  private readonly key: Buffer;

  constructor(
    secret: string,
    private readonly now: () => Date = () => new Date(),
    private readonly securityEvents?: SecurityEventEmitter
  ) {
    if (Buffer.byteLength(secret, "utf8") < 32) {
      throw new Error("RUN_AUTHORIZATION_SECRET must contain at least 32 bytes.");
    }
    this.key = Buffer.from(secret, "utf8");
  }

  issue(input: Omit<RunAuthorizationClaims, "schemaVersion">): string {
    const claims = parseClaims({ schemaVersion: 1, ...input });
    const now = this.now().getTime();
    const expiry = Date.parse(claims.expiresAt);
    if (expiry <= now || expiry - now > MAX_TOKEN_AGE_MS) {
      throw new Error("Run authorization expiry must be in the next hour.");
    }
    const encoded = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    return `${encoded}.${this.sign(encoded)}`;
  }

  verify(
    token: string | undefined,
    expected: RunAuthorizationExpectation
  ): RunAuthorizationClaims | undefined {
    const decoded = decodeSignedClaims(token, (encoded) => this.sign(encoded));
    if (!decoded.success) return this.deny(decoded.reason, expected);
    const denial = authorizationDenial(decoded.claims, expected, this.now());
    return denial ? this.deny(denial, expected) : decoded.claims;
  }

  private deny(
    reason: string,
    expected: RunAuthorizationExpectation
  ): RunAuthorizationClaims | undefined {
    emitSecurityEvent(this.securityEvents, {
      type: "authorization.denied",
      reason,
      ...(expected.workspaceId ? { workspaceId: expected.workspaceId } : {}),
      ...(expected.runId ? { runId: expected.runId } : {}),
      ...(expected.agentId ? { agentId: expected.agentId } : {}),
      ...(expected.requiredTool ? { operationId: expected.requiredTool } : {})
    });
    return undefined;
  }

  private sign(encoded: string): string {
    return createHmac("sha256", this.key).update(encoded, "utf8").digest("base64url");
  }
}

type SignedClaimsResult =
  | { success: true; claims: RunAuthorizationClaims }
  | { success: false; reason: string };

function decodeSignedClaims(
  token: string | undefined,
  sign: (encoded: string) => string
): SignedClaimsResult {
  if (!token) return { success: false, reason: "token_missing" };
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra !== undefined) {
    return { success: false, reason: "token_malformed" };
  }
  const actual = Buffer.from(signature, "base64url");
  const required = Buffer.from(sign(encoded), "base64url");
  if (actual.byteLength !== required.byteLength || !timingSafeEqual(actual, required)) {
    return { success: false, reason: "signature_invalid" };
  }
  try {
    const claims = parseClaims(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
    return { success: true, claims };
  } catch {
    return { success: false, reason: "claims_invalid" };
  }
}

function authorizationDenial(
  claims: RunAuthorizationClaims,
  expected: RunAuthorizationExpectation,
  now: Date
): string | undefined {
  if (Date.parse(claims.expiresAt) <= now.getTime()) return "token_expired";
  if (runOrWorkspaceMismatch(claims, expected)) return "run_or_workspace_mismatch";
  if (agentMismatch(claims, expected)) return "agent_mismatch";
  return executionIdentityDenial(claims, expected);
}

function runOrWorkspaceMismatch(
  claims: RunAuthorizationClaims,
  expected: RunAuthorizationExpectation
): boolean {
  return (
    (expected.runId !== undefined && claims.runId !== expected.runId) ||
    (expected.workspaceId !== undefined && claims.workspaceId !== expected.workspaceId)
  );
}

function agentMismatch(
  claims: RunAuthorizationClaims,
  expected: RunAuthorizationExpectation
): boolean {
  return Boolean(expected.agentId && claims.agentId && claims.agentId !== expected.agentId);
}

function executionIdentityDenial(
  claims: RunAuthorizationClaims,
  expected: RunAuthorizationExpectation
): string | undefined {
  if (!requiresExecutionIdentity(expected)) return undefined;
  return claims.executionIdentities.some((identity) => matchesExecutionIdentity(identity, expected))
    ? undefined
    : "execution_identity_mismatch";
}

function requiresExecutionIdentity(expected: RunAuthorizationExpectation): boolean {
  return [
    expected.agentId,
    expected.effectivePolicyDigest,
    expected.platformPolicyDigest,
    expected.resourceDigest,
    expected.runtimeImageId,
    expected.requiredTool
  ].some((value) => value !== undefined);
}

function matchesExecutionIdentity(
  identity: RunExecutionIdentity,
  expected: RunAuthorizationExpectation
): boolean {
  return (
    matchesOptional(identity.agentId, expected.agentId) &&
    matchesOptional(identity.effectivePolicyDigest, expected.effectivePolicyDigest) &&
    matchesOptional(identity.platformPolicyDigest, expected.platformPolicyDigest) &&
    matchesOptional(identity.resourceDigest, expected.resourceDigest) &&
    matchesOptional(identity.runtimeImageId, expected.runtimeImageId) &&
    (expected.requiredTool === undefined || identity.allowedTools.includes(expected.requiredTool))
  );
}

function matchesOptional(actual: string, expected: string | undefined): boolean {
  return expected === undefined || actual === expected;
}

function parseClaims(value: unknown): RunAuthorizationClaims {
  if (!isRecord(value) || value.schemaVersion !== 1) throw new Error("Invalid run authorization.");
  assertRequiredClaims(value);
  assertCatalogDigest(value);
  const executionIdentities = parseExecutionIdentities(value);
  assertAgentId(value);
  assertAllowedTools(value);
  assertExpiry(value);
  return {
    schemaVersion: 1,
    jobId: value.jobId as string,
    runId: value.runId as string,
    workspaceId: value.workspaceId as string,
    ...(value.agentId === undefined ? {} : { agentId: value.agentId as string }),
    catalogDigest: value.catalogDigest as string,
    executionIdentities,
    leaseOwner: value.leaseOwner as string,
    allowedTools: [...(value.allowedTools as string[])],
    expiresAt: value.expiresAt as string
  };
}

function assertRequiredClaims(value: Record<string, unknown>): void {
  const required = ["jobId", "runId", "workspaceId", "catalogDigest", "leaseOwner", "expiresAt"];
  for (const field of required) {
    if (typeof value[field] !== "string" || value[field].length === 0) {
      throw new Error(`Invalid run authorization ${field}.`);
    }
  }
}

function assertCatalogDigest(value: Record<string, unknown>): void {
  if (!DIGEST_PATTERN.test(value.catalogDigest as string)) {
    throw new Error("Invalid run authorization catalogDigest.");
  }
}

function parseExecutionIdentities(value: Record<string, unknown>): RunExecutionIdentity[] {
  if (
    !Array.isArray(value.executionIdentities) ||
    value.executionIdentities.length === 0 ||
    value.executionIdentities.length > 128
  ) {
    throw new Error("Invalid run authorization executionIdentities.");
  }
  const executionIdentities = value.executionIdentities.map(parseExecutionIdentity);
  if (new Set(executionIdentities.map(executionIdentityKey)).size !== executionIdentities.length) {
    throw new Error("Invalid run authorization executionIdentities.");
  }
  return executionIdentities;
}

function assertAgentId(value: Record<string, unknown>): void {
  if (value.agentId !== undefined && (typeof value.agentId !== "string" || !value.agentId)) {
    throw new Error("Invalid run authorization agentId.");
  }
}

function assertAllowedTools(value: Record<string, unknown>): void {
  if (
    !Array.isArray(value.allowedTools) ||
    value.allowedTools.some((tool) => typeof tool !== "string" || !tool)
  ) {
    throw new Error("Invalid run authorization allowedTools.");
  }
}

function assertExpiry(value: Record<string, unknown>): void {
  if (!Number.isFinite(Date.parse(value.expiresAt as string))) {
    throw new Error("Invalid run authorization expiresAt.");
  }
}

function parseExecutionIdentity(value: unknown): RunExecutionIdentity {
  if (!isRecord(value) || typeof value.agentId !== "string" || value.agentId.length === 0) {
    throw new Error("Invalid run authorization execution identity agentId.");
  }
  for (const field of [
    "effectivePolicyDigest",
    "platformPolicyDigest",
    "resourceDigest"
  ] as const) {
    if (typeof value[field] !== "string" || !DIGEST_PATTERN.test(value[field])) {
      throw new Error(`Invalid run authorization execution identity ${field}.`);
    }
  }
  if (
    typeof value.runtimeImageId !== "string" ||
    !RUNTIME_IMAGE_PATTERN.test(value.runtimeImageId)
  ) {
    throw new Error("Invalid run authorization execution identity runtimeImageId.");
  }
  const agentId = value.agentId;
  const effectivePolicyDigest = value.effectivePolicyDigest;
  const platformPolicyDigest = value.platformPolicyDigest;
  const resourceDigest = value.resourceDigest;
  const runtimeImageId = value.runtimeImageId;
  if (
    !Array.isArray(value.allowedTools) ||
    value.allowedTools.length > 256 ||
    value.allowedTools.some((tool) => typeof tool !== "string" || tool.length === 0) ||
    new Set(value.allowedTools).size !== value.allowedTools.length
  ) {
    throw new Error("Invalid run authorization execution identity allowedTools.");
  }
  return {
    agentId,
    allowedTools: [...(value.allowedTools as string[])],
    effectivePolicyDigest: effectivePolicyDigest as string,
    platformPolicyDigest: platformPolicyDigest as string,
    resourceDigest: resourceDigest as string,
    runtimeImageId
  };
}

function executionIdentityKey(identity: RunExecutionIdentity): string {
  return [
    identity.agentId,
    identity.effectivePolicyDigest,
    identity.platformPolicyDigest,
    identity.resourceDigest,
    identity.runtimeImageId,
    ...identity.allowedTools
  ].join("\\u0000");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
