import type {
  AgentCollaborationRepositoryPort,
  EffectiveRunPolicyResolver,
  JobQueuePort
} from "@second-brain/application";
import type { AgentRunV1, EffectiveRunPolicyV2, InternalJobV1 } from "@second-brain/contracts";
import type { AgentCatalog } from "@second-brain/domain";

import type { RunAuthorizationService } from "./run-authorization.js";

export interface ClaimAuthorizationDependencies {
  jobs: JobQueuePort;
  runs?: Pick<AgentCollaborationRepositoryPort, "getRun" | "updateRun">;
  agentCatalog?: AgentCatalog;
  runAuthorizations?: RunAuthorizationService;
  effectiveRunPolicies?: Pick<EffectiveRunPolicyResolver, "resolve" | "resolveIfActive">;
}

export async function authorizeClaimedRuns(
  jobs: InternalJobV1[],
  dependencies: ClaimAuthorizationDependencies,
  now: Date
): Promise<InternalJobV1[]> {
  if (!dependencies.runAuthorizations || !dependencies.agentCatalog) return jobs;
  const authorized: InternalJobV1[] = [];
  for (const job of jobs) {
    try {
      authorized.push(await authorizeClaimedRun(job, dependencies, now));
    } catch (error) {
      await rejectClaimAfterAuthorizationFailure(job, error, dependencies, now);
    }
  }
  return authorized;
}

async function authorizeClaimedRun(
  job: InternalJobV1,
  dependencies: ClaimAuthorizationDependencies,
  now: Date
): Promise<InternalJobV1> {
  return job.type === "run_agent"
    ? authorizeDelegatedRun(job, dependencies, now)
    : authorizeRootRun(job, dependencies, now);
}

async function authorizeRootRun(
  job: InternalJobV1,
  dependencies: ClaimAuthorizationDependencies,
  now: Date
): Promise<InternalJobV1> {
  if (!job.workspaceId || !job.leaseOwner || !job.leaseExpiresAt) return job;
  const requestedAgentId =
    typeof job.payload.agentId === "string" ? job.payload.agentId : undefined;
  if (!requestedAgentId) return job;

  const agentCatalog = dependencies.agentCatalog!;
  const requestedAgent = agentCatalog.require(requestedAgentId);
  const routesInbound = requestedAgent.routesInbound === true;
  const selectedAgents = routesInbound ? agentCatalog.ids() : [requestedAgentId];
  const effectiveRunPolicies = await resolveRootPolicies({
    dependencies,
    workspaceId: job.workspaceId,
    requestedAgentId,
    selectedAgents,
    routesInbound
  });
  const allowedTools = effectiveRunPolicies
    ? [...new Set(effectiveRunPolicies.flatMap((policy) => policy.toolIds))].sort()
    : [...new Set(selectedAgents.flatMap((id) => [...agentCatalog.require(id).toolPolicy]))].sort();
  return {
    ...job,
    ...(effectiveRunPolicies ? { effectiveRunPolicies } : {}),
    runAuthorization: dependencies.runAuthorizations!.issue({
      jobId: job.id,
      runId: job.id,
      workspaceId: job.workspaceId,
      ...(routesInbound ? {} : { agentId: requestedAgentId }),
      catalogDigest: agentCatalog.digest,
      executionIdentities: executionIdentitiesForPolicies(effectiveRunPolicies),
      leaseOwner: job.leaseOwner,
      allowedTools,
      expiresAt: boundedExpiry(job.leaseExpiresAt, now)
    })
  };
}

async function resolveRootPolicies(input: {
  dependencies: ClaimAuthorizationDependencies;
  workspaceId: string;
  requestedAgentId: string;
  selectedAgents: readonly string[];
  routesInbound: boolean;
}) {
  const { dependencies, workspaceId, requestedAgentId, selectedAgents, routesInbound } = input;
  const resolver = dependencies.effectiveRunPolicies;
  if (!resolver) return undefined;
  if (!routesInbound) return [await resolver.resolve({ workspaceId, agentId: requestedAgentId })];
  const policies = await Promise.all(
    selectedAgents.map((agentId) => resolver.resolveIfActive({ workspaceId, agentId }))
  );
  return policies.filter((policy) => policy !== undefined);
}

async function authorizeDelegatedRun(
  job: InternalJobV1,
  dependencies: ClaimAuthorizationDependencies,
  now: Date
): Promise<InternalJobV1> {
  const runId = typeof job.payload.runId === "string" ? job.payload.runId : undefined;
  if (!runId || !dependencies.runs) return job;
  const run = await dependencies.runs.getRun(runId);
  if (!run || run.workspaceId !== job.workspaceId || !job.leaseOwner || !job.leaseExpiresAt) {
    return job;
  }
  const expiresAt = boundedExpiry(job.leaseExpiresAt, now, run.deadlineAt);
  if (Date.parse(expiresAt) <= now.getTime()) return job;
  const delegatedTools = Array.isArray(job.payload.allowedTools)
    ? job.payload.allowedTools.filter((tool): tool is string => typeof tool === "string")
    : [];
  const effectiveRunPolicy = dependencies.effectiveRunPolicies
    ? await dependencies.effectiveRunPolicies.resolve({
        workspaceId: run.workspaceId,
        agentId: run.agentId,
        delegatedToolPolicy: delegatedTools
      })
    : undefined;
  if (!effectiveRunPolicy) {
    throw new Error("Run execution identity is unavailable for delegated work.");
  }
  assertDurableExecutionIdentity(run, job, effectiveRunPolicy);
  return {
    ...job,
    effectiveRunPolicies: [effectiveRunPolicy],
    runAuthorization: dependencies.runAuthorizations!.issue({
      jobId: job.id,
      runId: run.id,
      workspaceId: run.workspaceId,
      agentId: run.agentId,
      catalogDigest: run.catalogDigest,
      executionIdentities: executionIdentitiesForPolicies([effectiveRunPolicy]),
      leaseOwner: job.leaseOwner,
      allowedTools: effectiveRunPolicy.toolIds,
      expiresAt
    })
  };
}

async function rejectClaimAfterAuthorizationFailure(
  job: InternalJobV1,
  error: unknown,
  dependencies: ClaimAuthorizationDependencies,
  now: Date
): Promise<void> {
  if (!job.leaseOwner) throw error;
  const reason = error instanceof Error ? error.message : "Claim authorization failed.";
  const terminal =
    reason.startsWith("Agent plugin is disabled for this workspace:") ||
    reason.startsWith("Run execution identity");
  const failed = await dependencies.jobs.fail({
    jobId: job.id,
    leaseOwner: job.leaseOwner,
    now,
    retryable: !terminal,
    reason,
    retryDelayMs: 1_000,
    maxAttempts: terminal ? 1 : 3
  });
  if (failed.status !== "dead_letter" || job.type !== "run_agent" || !dependencies.runs) return;
  const runId = typeof job.payload.runId === "string" ? job.payload.runId : undefined;
  if (!runId) return;
  const run = await dependencies.runs.getRun(runId);
  if (!run || run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
    return;
  }
  await dependencies.runs.updateRun({
    ...run,
    status: "failed",
    completedAt: now.toISOString(),
    resultText: reason
  });
}

function assertDurableExecutionIdentity(
  run: AgentRunV1,
  job: InternalJobV1,
  policy: EffectiveRunPolicyV2
): void {
  if (
    !run.effectivePolicyDigest ||
    !run.platformPolicyDigest ||
    !run.resourceDigest ||
    !run.runtimeImageId
  ) {
    throw new Error("Run execution identity is missing; legacy queued work cannot execute.");
  }
  if (
    run.effectivePolicyDigest !== policy.policyDigest ||
    run.platformPolicyDigest !== policy.platformPolicyDigest ||
    run.resourceDigest !== policy.resourceDigest ||
    run.runtimeImageId !== policy.runtimeImageId
  ) {
    throw new Error("Run execution identity no longer matches the active effective policy.");
  }
  const queuedDigest = job.payload.effectivePolicyDigest;
  if (queuedDigest !== undefined && queuedDigest !== run.effectivePolicyDigest) {
    throw new Error("Run execution identity does not match its queued policy digest.");
  }
}

function executionIdentitiesForPolicies(
  policies: readonly EffectiveRunPolicyV2[] | undefined
): Array<{
  agentId: string;
  allowedTools: string[];
  effectivePolicyDigest: string;
  platformPolicyDigest: string;
  resourceDigest: string;
  runtimeImageId: string;
}> {
  if (!policies?.length) {
    throw new Error("Run execution identity is unavailable for claimed work.");
  }
  return policies.map((policy) => ({
    agentId: policy.agentId,
    allowedTools: [...policy.toolIds],
    effectivePolicyDigest: policy.policyDigest,
    platformPolicyDigest: policy.platformPolicyDigest,
    resourceDigest: policy.resourceDigest,
    runtimeImageId: policy.runtimeImageId
  }));
}

function boundedExpiry(leaseExpiresAt: string, now: Date, deadlineAt?: string): string {
  return new Date(
    Math.min(
      Date.parse(leaseExpiresAt),
      ...(deadlineAt ? [Date.parse(deadlineAt)] : []),
      now.getTime() + 60 * 60 * 1_000
    )
  ).toISOString();
}
