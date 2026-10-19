import type { IncomingMessage, ServerResponse } from "node:http";

import type {
  AgentCollaborationRepositoryPort,
  WorkspaceWriteLeaseRepositoryPort
} from "@second-brain/application";
import {
  AgentArtifactV1Schema,
  AgentRunV1Schema,
  WorkspaceWriteLeaseV1Schema
} from "@second-brain/contracts";

import type { RunAuthorizationService } from "../authorization/run-authorization.js";

type ReadJson = (request: IncomingMessage) => Promise<unknown>;
type WriteJson = (response: ServerResponse, statusCode: number, body: unknown) => void;

interface WorkerCollaborationDependencies {
  runs: AgentCollaborationRepositoryPort;
  leases: WorkspaceWriteLeaseRepositoryPort;
  token?: string;
  runAuthorizations?: RunAuthorizationService;
  readJson: ReadJson;
  writeJson: WriteJson;
}

interface RouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  method: string;
  path: string;
  deps: WorkerCollaborationDependencies;
}

type RouteHandler = (context: RouteContext) => Promise<boolean>;

const routeHandlers: readonly RouteHandler[] = [
  createAgentRun,
  getAgentRun,
  getDelegationGrant,
  updateAgentRun,
  createAgentArtifact,
  getWorkspaceLease,
  acquireOrRenewWorkspaceLease,
  releaseWorkspaceLease
];

/** Authenticated persistence boundary used only by the durable agent worker. */
export async function handleWorkerCollaborationRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  deps: WorkerCollaborationDependencies
): Promise<boolean> {
  const prefix = "/v1/internal/agent-collaboration/";
  if (!url.pathname.startsWith(prefix)) return false;
  if (!deps.token || request.headers.authorization !== `Bearer ${deps.token}`) {
    deps.writeJson(response, 401, { error: "agent_collaboration_unauthorized" });
    return true;
  }

  const context: RouteContext = {
    request,
    response,
    method: request.method ?? "GET",
    path: url.pathname.slice(prefix.length),
    deps
  };
  for (const handler of routeHandlers) {
    if (await handler(context)) return true;
  }
  return false;
}

async function createAgentRun(context: RouteContext): Promise<boolean> {
  if (context.method !== "POST" || context.path !== "runs") return false;
  const parsed = AgentRunV1Schema.safeParse(await context.deps.readJson(context.request));
  if (
    !parsed.success ||
    parsed.data.status !== "running" ||
    parsed.data.parentRunId !== undefined ||
    parsed.data.delegationGrantId !== undefined
  ) {
    context.deps.writeJson(context.response, 400, { error: "invalid_root_agent_run" });
    return true;
  }
  const authorized = context.deps.runAuthorizations?.verify(
    runAuthorizationHeader(context.request),
    {
      runId: parsed.data.id,
      workspaceId: parsed.data.workspaceId,
      agentId: parsed.data.agentId
    }
  );
  if (
    !authorized ||
    authorized.jobId !== authorized.runId ||
    authorized.catalogDigest !== parsed.data.catalogDigest
  ) {
    context.deps.writeJson(context.response, 403, { error: "agent_run_forbidden" });
    return true;
  }
  context.deps.writeJson(context.response, 201, await context.deps.runs.createRun(parsed.data));
  return true;
}

async function getAgentRun(context: RouteContext): Promise<boolean> {
  if (context.method !== "GET") return false;
  const id = singlePathId(context.path, "runs/");
  if (id === undefined) return false;
  const run = await context.deps.runs.getRun(id);
  context.deps.writeJson(context.response, run ? 200 : 404, run ?? { error: "not_found" });
  return true;
}

async function getDelegationGrant(context: RouteContext): Promise<boolean> {
  if (context.method !== "GET") return false;
  const id = singlePathId(context.path, "grants/");
  if (id === undefined) return false;
  const grant = await context.deps.runs.getGrant(id);
  context.deps.writeJson(context.response, grant ? 200 : 404, grant ?? { error: "not_found" });
  return true;
}

async function updateAgentRun(context: RouteContext): Promise<boolean> {
  if (context.method !== "PUT") return false;
  const id = singlePathId(context.path, "runs/");
  if (id === undefined) return false;
  const parsed = AgentRunV1Schema.safeParse(await context.deps.readJson(context.request));
  if (!parsed.success || parsed.data.id !== id) {
    context.deps.writeJson(context.response, 400, { error: "invalid_agent_run_update" });
    return true;
  }
  if (!authorizeRun(context, parsed.data.id, parsed.data.workspaceId, parsed.data.agentId)) {
    context.deps.writeJson(context.response, 403, { error: "agent_run_forbidden" });
    return true;
  }
  context.deps.writeJson(context.response, 200, await context.deps.runs.updateRun(parsed.data));
  return true;
}

async function createAgentArtifact(context: RouteContext): Promise<boolean> {
  if (context.method !== "POST" || context.path !== "artifacts") return false;
  const parsed = AgentArtifactV1Schema.safeParse(await context.deps.readJson(context.request));
  if (!parsed.success) {
    context.deps.writeJson(context.response, 400, { error: "invalid_agent_artifact" });
    return true;
  }
  if (!authorizeRun(context, parsed.data.producingRunId, parsed.data.workspaceId)) {
    context.deps.writeJson(context.response, 403, { error: "agent_run_forbidden" });
    return true;
  }
  context.deps.writeJson(
    context.response,
    201,
    await context.deps.runs.createArtifact(parsed.data)
  );
  return true;
}

async function getWorkspaceLease(context: RouteContext): Promise<boolean> {
  if (context.method !== "GET") return false;
  const workspaceId = singlePathId(context.path, "leases/");
  if (workspaceId === undefined) return false;
  const lease = await context.deps.leases.get(workspaceId);
  context.deps.writeJson(context.response, lease ? 200 : 404, lease ?? { error: "not_found" });
  return true;
}

async function acquireOrRenewWorkspaceLease(context: RouteContext): Promise<boolean> {
  if ((context.method !== "POST" && context.method !== "PUT") || context.path !== "leases") {
    return false;
  }
  const parsed = WorkspaceWriteLeaseV1Schema.safeParse(
    await context.deps.readJson(context.request)
  );
  if (!parsed.success) {
    context.deps.writeJson(context.response, 400, { error: "invalid_workspace_write_lease" });
    return true;
  }
  if (!authorizeRun(context, parsed.data.ownerRunId, parsed.data.workspaceId)) {
    context.deps.writeJson(context.response, 403, { error: "agent_run_forbidden" });
    return true;
  }
  const result =
    context.method === "POST"
      ? await context.deps.leases.acquire(parsed.data, new Date())
      : await context.deps.leases.renew(parsed.data, new Date());
  context.deps.writeJson(
    context.response,
    result ? 200 : 409,
    result ?? { error: "lease_conflict" }
  );
  return true;
}

async function releaseWorkspaceLease(context: RouteContext): Promise<boolean> {
  if (context.method !== "DELETE" || !context.path.startsWith("leases/")) return false;
  const [workspaceId, ownerRunId, extra] = context.path.slice("leases/".length).split("/");
  if (!workspaceId || !ownerRunId || extra !== undefined) return false;
  const decodedWorkspaceId = decodeURIComponent(workspaceId);
  const decodedOwnerRunId = decodeURIComponent(ownerRunId);
  if (!authorizeRun(context, decodedOwnerRunId, decodedWorkspaceId)) {
    context.deps.writeJson(context.response, 403, { error: "agent_run_forbidden" });
    return true;
  }
  const released = await context.deps.leases.release({
    workspaceId: decodedWorkspaceId,
    ownerRunId: decodedOwnerRunId
  });
  context.deps.writeJson(
    context.response,
    released ? 200 : 409,
    released ? { released: true } : { error: "lease_conflict" }
  );
  return true;
}

function authorizeRun(
  context: RouteContext,
  runId: string,
  workspaceId: string,
  agentId?: string
): boolean {
  return Boolean(
    context.deps.runAuthorizations?.verify(runAuthorizationHeader(context.request), {
      runId,
      workspaceId,
      ...(agentId ? { agentId } : {})
    })
  );
}

function singlePathId(path: string, prefix: string): string | undefined {
  if (!path.startsWith(prefix)) return undefined;
  const id = decodeURIComponent(path.slice(prefix.length));
  return id && !id.includes("/") ? id : undefined;
}

function runAuthorizationHeader(request: IncomingMessage): string | undefined {
  const header = request.headers["x-jarvis-run-authorization"];
  return typeof header === "string" ? header : undefined;
}
