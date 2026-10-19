import type { BrainWorkerConfig } from "@second-brain/configuration";
import { HealthStatusV1Schema, INTERNAL_API_VERSION } from "@second-brain/contracts";
import {
  aggregateHealthStatus,
  pingHttpUrl,
  type StructuredLogger
} from "@second-brain/observability";

interface UpstreamHealthSummary {
  readonly envelope: ReturnType<typeof aggregateHealthStatus>;
}

/**
 * Probes each Brain Worker control-plane dependency through `pingHttpUrl`
 * and aggregates the result through `aggregateHealthStatus`. The worker
 * uses the envelope in its startup log so an unreachable upstream is
 * visible immediately.
 */
export async function checkUpstreamReadiness(
  workerConfig: BrainWorkerConfig,
  catalogDigest: string,
  policyDigest: string | undefined,
  logger: StructuredLogger
): Promise<UpstreamHealthSummary>;
export async function checkUpstreamReadiness(
  workerConfig: BrainWorkerConfig,
  catalogDigest: string,
  logger: StructuredLogger
): Promise<UpstreamHealthSummary>;
export async function checkUpstreamReadiness(
  workerConfig: BrainWorkerConfig,
  catalogDigest: string,
  policyDigestOrLogger: string | undefined | StructuredLogger,
  maybeLogger?: StructuredLogger
): Promise<UpstreamHealthSummary> {
  const policyDigest = typeof policyDigestOrLogger === "string" ? policyDigestOrLogger : undefined;
  const logger = typeof policyDigestOrLogger === "string" ? maybeLogger : policyDigestOrLogger;
  if (!logger) throw new Error("A readiness logger is required.");
  const dependencies = await Promise.all([
    inspectCatalogDependency(
      "brain-control",
      `${workerConfig.controlUrl}/health`,
      catalogDigest,
      policyDigest
    ),
    pingHttpUrl(`${workerConfig.mediaWorkerUrl}/health`).then((ready) =>
      ready
        ? { name: "media-worker", status: "ready" as const }
        : {
            name: "media-worker",
            status: "unavailable" as const,
            failureKind: "dependency_unavailable" as const,
            detail: "Dependency health request failed."
          }
    )
  ]);
  const degraded = dependencies.some((entry) => entry.status !== "ready");
  if (degraded) {
    logger.warn("brain-worker started with degraded upstream readiness", { dependencies });
  }
  const envelope = aggregateHealthStatus({
    service: "brain-worker",
    checkedAt: new Date().toISOString(),
    version: "0.0.0",
    apiVersion: INTERNAL_API_VERSION,
    catalogDigest,
    ...(policyDigest ? { policyDigest } : {}),
    dependencies
  });
  return { envelope };
}

async function inspectCatalogDependency(
  name: string,
  url: string,
  catalogDigest: string,
  policyDigest?: string
): Promise<{
  name: string;
  status: "ready" | "degraded" | "unavailable";
  failureKind?: "api_incompatible" | "policy_mismatch" | "dependency_unavailable";
  detail?: string;
}> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    if (!response.ok)
      return {
        name,
        status: "unavailable",
        failureKind: "dependency_unavailable",
        detail:
          typeof response.status === "number" ? `HTTP ${response.status}.` : "HTTP request failed."
      };
    const health = HealthStatusV1Schema.safeParse(await response.json());
    if (!health.success)
      return {
        name,
        status: "unavailable",
        failureKind: "api_incompatible",
        detail: "Invalid health envelope."
      };
    if (health.data.apiVersion !== INTERNAL_API_VERSION) {
      return {
        name,
        status: "unavailable",
        failureKind: "api_incompatible",
        detail: `Expected API version ${INTERNAL_API_VERSION}.`
      };
    }
    if (policyDigest !== undefined && health.data.policyDigest !== policyDigest) {
      return {
        name,
        status: "degraded",
        failureKind: "policy_mismatch",
        detail: "Platform policy digest does not match."
      };
    }
    if (policyDigest === undefined && health.data.catalogDigest !== catalogDigest) {
      return {
        name,
        status: "degraded",
        failureKind: "policy_mismatch",
        detail: "Platform catalog digest does not match."
      };
    }
    if (policyDigest !== undefined && health.data.catalogDigest !== catalogDigest) {
      return {
        name,
        status: "ready",
        detail: "Platform catalog digest differs; policy digest matches."
      };
    }
    return { name, status: "ready" };
  } catch {
    return {
      name,
      status: "unavailable",
      failureKind: "dependency_unavailable",
      detail: "Dependency health request failed."
    };
  }
}
