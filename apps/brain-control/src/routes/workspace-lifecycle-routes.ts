import type { IncomingMessage, ServerResponse } from "node:http";

import {
  InactiveWorkspaceRuntimeRecoveryError,
  UnknownWorkspaceRoomLifecycleError,
  UnknownWorkspaceRoomRuntimeRecoveryError
} from "@second-brain/application";
import {
  WorkspaceInviteAcceptanceRequestV1Schema,
  WorkspaceInviteAcceptanceResponseV1Schema,
  WorkspaceRoomArchiveResponseV1Schema,
  WorkspaceRoomResolutionRequestV1Schema,
  WorkspaceRoomRuntimeRecoveryResponseV1Schema
} from "@second-brain/contracts";

import type { WorkspaceRouteDependencies } from "./workspace-routes.js";

interface LifecycleRouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  dependencies: WorkspaceRouteDependencies;
}

export async function recoverRoomRuntime(context: LifecycleRouteContext): Promise<boolean> {
  const { dependencies, request, response } = context;
  if (!dependencies.workspaceRoomRuntimeRecovery) return false;
  const parsed = WorkspaceRoomResolutionRequestV1Schema.safeParse(
    await dependencies.readJson(request)
  );
  if (!parsed.success) {
    dependencies.writeJson(response, 400, { error: "invalid_workspace_room_runtime_recovery" });
    return true;
  }
  try {
    const workspace = await dependencies.workspaceRoomRuntimeRecovery.recoverRoom(
      parsed.data.roomId
    );
    dependencies.writeJson(
      response,
      200,
      WorkspaceRoomRuntimeRecoveryResponseV1Schema.parse({ status: workspace.status })
    );
  } catch (error) {
    if (error instanceof UnknownWorkspaceRoomRuntimeRecoveryError) {
      dependencies.writeJson(response, 404, { error: "workspace_room_not_found" });
      return true;
    }
    if (error instanceof InactiveWorkspaceRuntimeRecoveryError) {
      dependencies.writeJson(response, 409, { error: "workspace_not_active" });
      return true;
    }
    throw error;
  }
  return true;
}

export async function archiveRoom(context: LifecycleRouteContext): Promise<boolean> {
  const { dependencies, request, response } = context;
  if (!dependencies.workspaceRoomLifecycle) return false;
  const parsed = WorkspaceRoomResolutionRequestV1Schema.safeParse(
    await dependencies.readJson(request)
  );
  if (!parsed.success) {
    dependencies.writeJson(response, 400, { error: "invalid_workspace_room_archive" });
    return true;
  }
  try {
    const workspace = await dependencies.workspaceRoomLifecycle.archiveRoom(parsed.data.roomId);
    dependencies.writeJson(
      response,
      200,
      WorkspaceRoomArchiveResponseV1Schema.parse({ archived: workspace.status === "archived" })
    );
  } catch (error) {
    if (!(error instanceof UnknownWorkspaceRoomLifecycleError)) throw error;
    dependencies.writeJson(response, 404, { error: "workspace_room_not_found" });
  }
  return true;
}

export async function acceptTrustedInvite(context: LifecycleRouteContext): Promise<true> {
  const { dependencies, request, response } = context;
  const parsed = WorkspaceInviteAcceptanceRequestV1Schema.safeParse(
    await dependencies.readJson(request)
  );
  if (!parsed.success) {
    dependencies.writeJson(response, 400, {
      error: "invalid_workspace_invite_acceptance",
      issues: parsed.error.issues
    });
    return true;
  }
  const accepted = await dependencies.workspaceInvitation.acceptTrustedInvite(parsed.data.roomId);
  if (accepted.created && dependencies.outbounds) {
    await publishWorkspaceWelcome(parsed.data.roomId, accepted.workspace, dependencies);
  }
  dependencies.writeJson(
    response,
    200,
    WorkspaceInviteAcceptanceResponseV1Schema.parse({
      workspaceId: accepted.workspace.id,
      templateId: accepted.workspace.templateId,
      templateVersion: accepted.workspace.templateVersion,
      status: accepted.workspace.status,
      defaultAgent: accepted.workspace.defaultAgent ?? dependencies.defaultAgentId ?? "brain",
      created: accepted.created
    })
  );
  return true;
}

async function publishWorkspaceWelcome(
  roomId: string,
  workspace: {
    id: string;
    defaultAgent?: string | undefined;
  },
  dependencies: WorkspaceRouteDependencies
): Promise<void> {
  const defaultAgent = workspace.defaultAgent ?? dependencies.defaultAgentId ?? "brain";
  await dependencies.outbounds!.create({
    schemaVersion: 1,
    id: `outbound-welcome-${workspace.id}`,
    traceId: `trace-welcome-${workspace.id}`,
    workspaceId: workspace.id,
    conversationId: roomId,
    text: `Ready. Default agent: ${defaultAgent}. Use /agents to browse agents or /help for commands.`,
    images: [],
    presentation: "notice",
    urgency: "normal",
    idempotencyKey: `${workspace.id}:room-welcome`
  });
}
