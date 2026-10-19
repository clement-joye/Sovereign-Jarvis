import type { IncomingMessage, ServerResponse } from "node:http";

import type {
  AgentRunCancellationService,
  AgentCollaborationRepositoryPort,
  EffectiveRunPolicyResolver,
  OutboundRepositoryPort,
  PlannerDelegationService
} from "@second-brain/application";
import {
  AgentRunV1Schema,
  PlannerDelegationSpecV1Schema,
  type AgentRunV1,
  type EffectiveRunPolicyV2
} from "@second-brain/contracts";
import type { JobQueuePort } from "@second-brain/application";

import type { RunAuthorizationService } from "../authorization/run-authorization.js";

type ReadJson = (request: IncomingMessage) => Promise<unknown>;
type WriteJson = (response: ServerResponse, statusCode: number, body: unknown) => void;

export interface PlannerDelegationDependencies {
  runs: AgentCollaborationRepositoryPort;
  planner: PlannerDelegationService;
  cancellation?: AgentRunCancellationService;
  effectiveRunPolicies?: Pick<EffectiveRunPolicyResolver, "resolve">;
  waitForChild?: typeof waitForChild;
  runAuthorizations?: RunAuthorizationService;
  outbounds?: Pick<OutboundRepositoryPort, "create">;
  jobs?: Pick<JobQueuePort, "enqueue">;
  readJson: ReadJson;
  writeJson: WriteJson;
}

export interface PlannerDelegationRouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  method: string;
  bearer: string | undefined;
  deps: PlannerDelegationDependencies;
}

type RouteHandler = (context: PlannerDelegationRouteContext) => Promise<boolean>;

export const plannerDelegationRouteHandlers: readonly RouteHandler[] = [
  cancelAgentRun,
  createPlannerDelegation,
  getAgentRunResource
];

async function cancelAgentRun(context: PlannerDelegationRouteContext): Promise<boolean> {
  const match = context.url.pathname.match(/^\/v1\/agent-runs\/([^/]+)\/cancel$/);
  if (context.method !== "POST" || !match) return false;
  if (!context.deps.cancellation) return false;

  const targetId = decodeURIComponent(match[1]!);
  const target = await context.deps.runs.getRun(targetId);
  const authorized = Boolean(
    target &&
      context.deps.runAuthorizations?.verify(context.bearer, {
        runId: target.parentRunId ?? target.id,
        workspaceId: target.workspaceId,
        requiredTool: "delegate_status"
      })
  );
  if (!authorized) return forbidden(context);

  const cancelled = await context.deps.cancellation.cancel(targetId);
  context.deps.writeJson(
    context.response,
    cancelled ? 200 : 404,
    cancelled ?? { error: "not_found" }
  );
  return true;
}

async function createPlannerDelegation(context: PlannerDelegationRouteContext): Promise<boolean> {
  if (context.method !== "POST" || context.url.pathname !== "/v1/planner-delegations") return false;

  const body = await context.deps.readJson(context.request);
  const parent = AgentRunV1Schema.safeParse((body as { parent?: unknown })?.parent);
  const spec = PlannerDelegationSpecV1Schema.safeParse((body as { spec?: unknown })?.spec);
  if (!parent.success || !spec.success) {
    context.deps.writeJson(context.response, 400, {
      error: "invalid_planner_delegation",
      parentIssues: validationIssues(parent),
      specIssues: validationIssues(spec)
    });
    return true;
  }
  if (
    !context.deps.runAuthorizations?.verify(context.bearer, {
      runId: parent.data.id,
      workspaceId: parent.data.workspaceId,
      agentId: parent.data.agentId,
      requiredTool: "delegate"
    })
  ) {
    return forbidden(context);
  }
  const target = await resolveDelegationTargetPolicy(context, parent.data.workspaceId, spec.data);
  if (!target.available) return true;

  const storedParent = await context.deps.runs.createRun(parent.data);
  const child = await context.deps.planner.delegate({
    parent: storedParent,
    spec: spec.data,
    ...(target.policy ? { effectiveRunPolicy: target.policy } : {})
  });
  await createDelegationNotice(context.deps.runs, context.deps.outbounds, storedParent, child);
  await enqueueDelayedProgressNotice(context.deps.jobs, storedParent, child);
  const completed = await (context.deps.waitForChild ?? waitForChild)(
    context.deps.runs,
    child,
    child.timeoutSeconds
  );
  if (!completed) {
    await context.deps.cancellation?.cancel(child.id);
    context.deps.writeJson(context.response, 504, {
      error: "planner_delegation_timeout",
      childRunId: child.id
    });
    return true;
  }
  context.deps.writeJson(context.response, 201, completed);
  return true;
}

const PROGRESS_NOTICE_DELAY_MS = 35_000;
const MAX_IMMEDIATE_NOTICES_PER_ROOT = 3;

async function enqueueDelayedProgressNotice(
  jobs: PlannerDelegationDependencies["jobs"],
  parent: AgentRunV1,
  child: AgentRunV1
): Promise<void> {
  if (!parent.noticeOrigin || !jobs) return;
  const availableAt = new Date(Date.parse(child.createdAt) + PROGRESS_NOTICE_DELAY_MS);
  await jobs.enqueue({
    schemaVersion: 1,
    id: `progress-notice-${parent.rootRunId}`,
    workspaceId: parent.workspaceId,
    type: "progress_notice",
    payload: { rootRunId: parent.rootRunId },
    priority: 10,
    status: "pending",
    attempts: 0,
    availableAt: availableAt.toISOString(),
    idempotencyKey: `progress_notice:${parent.workspaceId}:${parent.rootRunId}`
  });
}

async function createDelegationNotice(
  runs: AgentCollaborationRepositoryPort,
  outbounds: PlannerDelegationDependencies["outbounds"],
  parent: AgentRunV1,
  child: AgentRunV1
): Promise<void> {
  if (!parent.noticeOrigin || !outbounds) return;
  if (
    !(await runs.claimDelegationNotice(parent.rootRunId, child.id, MAX_IMMEDIATE_NOTICES_PER_ROOT))
  ) {
    return;
  }
  const agentLabel = child.agentId
    .split(/[-_]/u)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  await outbounds.create({
    schemaVersion: 1,
    id: `delegation-notice-${child.id}-started`,
    traceId: child.rootRunId,
    workspaceId: child.workspaceId,
    conversationId: parent.noticeOrigin.conversationId,
    text: `Delegating to ${agentLabel}…`,
    images: [],
    replyToExternalEventId: parent.noticeOrigin.replyToExternalEventId,
    threadRootExternalEventId: parent.noticeOrigin.threadRootExternalEventId,
    presentation: "notice",
    urgency: "normal",
    idempotencyKey: `planner_delegation:${parent.rootRunId}:${child.id}:started`
  });
}

async function resolveDelegationTargetPolicy(
  context: PlannerDelegationRouteContext,
  workspaceId: string,
  spec: { targetAgentId: string; allowedTools: string[] }
): Promise<{ available: boolean; policy?: EffectiveRunPolicyV2 }> {
  if (!context.deps.effectiveRunPolicies) return { available: true };
  try {
    const policy = await context.deps.effectiveRunPolicies.resolve({
      workspaceId,
      agentId: spec.targetAgentId,
      delegatedToolPolicy: spec.allowedTools
    });
    return { available: true, policy };
  } catch (error) {
    context.deps.writeJson(context.response, 409, {
      error: "delegation_target_unavailable",
      message: error instanceof Error ? error.message : "Delegation target is unavailable."
    });
    return { available: false };
  }
}

async function getAgentRunResource(context: PlannerDelegationRouteContext): Promise<boolean> {
  const match = context.url.pathname.match(
    /^\/v1\/agent-runs\/([^/]+)(?:\/(children|artifacts))?$/
  );
  if (context.method !== "GET" || !match) return false;

  const run = await context.deps.runs.getRun(decodeURIComponent(match[1]!));
  if (!run) {
    context.deps.writeJson(context.response, 404, { error: "not_found" });
    return true;
  }
  if (
    !context.deps.runAuthorizations?.verify(context.bearer, {
      runId: run.id,
      workspaceId: run.workspaceId,
      requiredTool: "delegate_status"
    })
  ) {
    return forbidden(context);
  }

  const resource = match[2];
  if (resource === "children") {
    context.deps.writeJson(context.response, 200, await context.deps.planner.childResults(run.id));
  } else if (resource === "artifacts") {
    context.deps.writeJson(
      context.response,
      200,
      await context.deps.runs.listArtifactsByRun(run.id)
    );
  } else {
    context.deps.writeJson(context.response, 200, run);
  }
  return true;
}

function forbidden(context: PlannerDelegationRouteContext): true {
  context.deps.writeJson(context.response, 403, { error: "planner_delegation_forbidden" });
  return true;
}

export async function waitForChild(
  runs: Pick<AgentCollaborationRepositoryPort, "getRun">,
  child: Awaited<ReturnType<PlannerDelegationService["delegate"]>>,
  timeoutSeconds: number
): Promise<Awaited<ReturnType<PlannerDelegationService["delegate"]>> | undefined> {
  const deadline = Date.now() + timeoutSeconds * 1_000;
  let current = child;
  while ((current.status === "queued" || current.status === "running") && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    const refreshed = await runs.getRun(child.id);
    if (refreshed) current = refreshed;
  }
  return current.status === "queued" || current.status === "running" ? undefined : current;
}

function validationIssues(result: {
  success: boolean;
  error?: { issues: Array<{ path: PropertyKey[]; message: string }> };
}): Array<{ path: string; message: string }> {
  if (result.success) return [];
  return (result.error?.issues ?? []).map((issue) => ({
    path: issue.path.join("."),
    message: issue.message
  }));
}
