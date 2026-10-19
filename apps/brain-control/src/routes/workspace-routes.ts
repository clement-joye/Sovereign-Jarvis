import type { IncomingMessage, ServerResponse } from "node:http";

import {
  WorkspaceRoomResolutionRequestV1Schema,
  WorkspaceRoomResolutionResponseV1Schema
} from "@second-brain/contracts";

import { UnknownWorkspaceError, UnknownWorkspaceRoomError } from "@second-brain/application";
import type {
  WorkspaceInvitationService,
  WorkspaceLifecycleRoomResolutionService,
  RoomLifecycleCommandSubmissionService,
  RoomAgentCommandSubmissionService,
  RoomPluginCommandSubmissionService,
  WorkspaceRoomLifecycleService,
  WorkspaceRoomRuntimeRecoveryService,
  WorkspaceResolutionService,
  OutboundRepositoryPort
} from "@second-brain/application";
import { WorkspaceStatusV1Schema } from "@second-brain/contracts";

import { parseOpaquePathParameter } from "./path-parameters.js";
import {
  submitLifecycleCommand,
  submitRoomAgentCommand,
  submitRoomPluginCommand
} from "./workspace-command-routes.js";
import {
  acceptTrustedInvite,
  archiveRoom,
  recoverRoomRuntime
} from "./workspace-lifecycle-routes.js";

type ReadJson = (request: IncomingMessage) => Promise<unknown>;
type WriteJson = (response: ServerResponse, statusCode: number, body: unknown) => void;

export interface WorkspaceRouteDependencies {
  workspaceResolution: WorkspaceResolutionService;
  workspaceLifecycleResolution?: WorkspaceLifecycleRoomResolutionService;
  workspaceInvitation: WorkspaceInvitationService;
  roomLifecycleCommands?: RoomLifecycleCommandSubmissionService;
  roomAgentCommands?: RoomAgentCommandSubmissionService;
  roomPluginCommands?: RoomPluginCommandSubmissionService;
  outbounds?: Pick<OutboundRepositoryPort, "create">;
  workspaceRoomLifecycle?: WorkspaceRoomLifecycleService;
  workspaceRoomRuntimeRecovery?: WorkspaceRoomRuntimeRecoveryService;
  readJson: ReadJson;
  writeJson: WriteJson;
  defaultAgentId?: string;
}

interface WorkspaceRouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  dependencies: WorkspaceRouteDependencies;
}

const postWorkspaceRoutes: Readonly<
  Record<string, (context: WorkspaceRouteContext) => Promise<boolean>>
> = {
  "/v1/workspaces/accept-trusted-invite": acceptTrustedInvite,
  "/v1/workspaces/lifecycle-command": submitLifecycleCommand,
  "/v1/workspaces/agent-command": submitRoomAgentCommand,
  "/v1/workspaces/plugin-command": submitRoomPluginCommand,
  "/v1/workspaces/archive-room": archiveRoom,
  "/v1/workspaces/recover-room": recoverRoomRuntime,
  "/v1/workspaces/resolve-room": ({ request, response, dependencies }) =>
    resolveRoom(request, response, dependencies)
};

/**
 * This route is for trusted internal callers only. It deliberately derives
 * workspace identity from a room binding instead of accepting an ID to trust.
 */
export async function handleWorkspaceRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  dependencies: WorkspaceRouteDependencies
): Promise<boolean> {
  const method = request.method ?? "GET";

  if (method === "GET" && url.pathname === "/v1/workspaces") {
    return listWorkspaces(request, response, url, dependencies);
  }
  const workspaceDetailPrefix = "/v1/workspaces/";
  if (
    method === "GET" &&
    url.pathname.startsWith("/v1/workspaces/") &&
    !url.pathname.slice(workspaceDetailPrefix.length).includes("/")
  ) {
    return getWorkspace(request, response, url, dependencies);
  }

  if (method !== "POST") return false;
  const handler = postWorkspaceRoutes[url.pathname];
  return handler ? handler({ request, response, dependencies }) : false;
}

async function resolveRoom(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: WorkspaceRouteDependencies
): Promise<boolean> {
  const parsed = WorkspaceRoomResolutionRequestV1Schema.safeParse(
    await dependencies.readJson(request)
  );
  if (!parsed.success) {
    dependencies.writeJson(response, 400, {
      error: "invalid_workspace_room_resolution",
      issues: parsed.error.issues
    });
    return true;
  }

  try {
    const workspace = await dependencies.workspaceResolution.resolveMatrixRoom(parsed.data.roomId);
    const selectedAgent = parsed.data.threadRootExternalEventId
      ? await dependencies.workspaceResolution.getThreadAgent({
          workspaceId: workspace.id,
          conversationId: parsed.data.roomId,
          threadRootExternalEventId: parsed.data.threadRootExternalEventId
        })
      : undefined;
    dependencies.writeJson(
      response,
      200,
      WorkspaceRoomResolutionResponseV1Schema.parse({
        workspaceId: workspace.id,
        templateId: workspace.templateId,
        templateVersion: workspace.templateVersion,
        status: workspace.status,
        defaultAgent: workspace.defaultAgent ?? dependencies.defaultAgentId ?? "brain",
        ...(selectedAgent ? { selectedAgent } : {})
      })
    );
  } catch (error) {
    if (error instanceof UnknownWorkspaceRoomError) {
      dependencies.writeJson(response, 404, { error: "workspace_room_not_found" });
      return true;
    }
    throw error;
  }
  return true;
}

async function listWorkspaces(
  _request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  dependencies: WorkspaceRouteDependencies
): Promise<boolean> {
  const statusParam = url.searchParams.get("status");
  if (statusParam !== null) {
    const parsed = WorkspaceStatusV1Schema.safeParse(statusParam);
    if (!parsed.success) {
      dependencies.writeJson(response, 400, {
        error: "invalid_workspace_status_filter",
        issues: parsed.error.issues
      });
      return true;
    }
    dependencies.writeJson(
      response,
      200,
      await dependencies.workspaceResolution.list({ status: parsed.data })
    );
    return true;
  }
  dependencies.writeJson(response, 200, await dependencies.workspaceResolution.list());
  return true;
}

async function getWorkspace(
  _request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  dependencies: WorkspaceRouteDependencies
): Promise<boolean> {
  const id = parseOpaquePathParameter(url.pathname.slice("/v1/workspaces/".length));
  if (id === undefined) {
    dependencies.writeJson(response, 400, { error: "invalid_workspace_id" });
    return true;
  }
  try {
    const workspace = await dependencies.workspaceResolution.get(id);
    dependencies.writeJson(response, 200, workspace);
  } catch (error) {
    if (error instanceof UnknownWorkspaceError) {
      dependencies.writeJson(response, 404, { error: "workspace_not_found" });
      return true;
    }
    throw error;
  }
  return true;
}
