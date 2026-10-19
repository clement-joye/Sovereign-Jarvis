import type { InternalApiRoute } from "../internal-api-route-types.js";
import {
  HealthStatusV1Schema,
  RoomLifecycleCommandRequestV1Schema,
  RoomLifecycleCommandResponseV1Schema,
  RoomPluginCommandRequestV1Schema,
  RoomPluginCommandResponseV1Schema,
  WorkspaceInviteAcceptanceRequestV1Schema,
  WorkspaceInviteAcceptanceResponseV1Schema,
  WorkspaceRoomResolutionRequestV1Schema,
  WorkspaceRoomResolutionResponseV1Schema,
  WorkspaceRoomRuntimeRecoveryResponseV1Schema
} from "../schemas.js";

export const WorkspaceInternalApiRoutes: readonly InternalApiRoute[] = [
  {
    method: "GET",
    path: "/v1/workspaces",
    operationId: "listWorkspaces",
    summary: "List every durable workspace; optional ?status filter narrows by lifecycle",
    responses: {
      "200": { description: "All workspaces in their durable order" },
      "400": { description: "Invalid status filter" }
    }
  },
  {
    method: "GET",
    path: "/v1/workspaces/{id}",
    operationId: "getWorkspace",
    summary: "Retrieve a single workspace by its identifier",
    pathParam: "id",
    responses: {
      "200": { description: "Workspace record" },
      "404": { description: "Workspace is not registered" }
    }
  },
  {
    method: "POST",
    path: "/v1/workspaces/recover-room",
    operationId: "recoverWorkspaceRoomRuntime",
    summary: "Recover the unhealthy runtime belonging to a trusted Matrix room",
    requestSchema: WorkspaceRoomResolutionRequestV1Schema,
    requestRequired: true,
    responses: {
      "200": {
        description: "Runtime is ready for the active workspace bound to the Matrix room",
        schema: WorkspaceRoomRuntimeRecoveryResponseV1Schema
      },
      "404": { description: "No workspace is bound to the Matrix room" },
      "409": { description: "Workspace is not active" }
    }
  },
  {
    method: "POST",
    path: "/v1/workspaces/lifecycle-command",
    operationId: "submitRoomLifecycleCommand",
    summary: "Apply a room lifecycle command in an active Matrix workspace",
    requestSchema: RoomLifecycleCommandRequestV1Schema,
    requestRequired: true,
    responses: {
      "200": {
        description: "Command was handled or was outside the workspace command surface",
        schema: RoomLifecycleCommandResponseV1Schema
      },
      "404": { description: "No workspace is bound to the Matrix room" },
      "409": { description: "Workspace is not active" }
    }
  },
  {
    method: "POST",
    path: "/v1/workspaces/plugin-command",
    operationId: "submitRoomPluginCommand",
    summary: "Manage a reviewed workspace plugin from its owner-authenticated Matrix room",
    requestSchema: RoomPluginCommandRequestV1Schema,
    requestRequired: true,
    responses: {
      "200": {
        description: "Command was handled or was outside the plugin command surface",
        schema: RoomPluginCommandResponseV1Schema
      },
      "404": { description: "No workspace is bound to the Matrix room" },
      "409": { description: "Workspace is not active" }
    }
  },
  {
    method: "POST",
    path: "/v1/workspaces/accept-trusted-invite",
    operationId: "acceptTrustedWorkspaceInvite",
    summary: "Create or recover a configuring workspace for a trusted Matrix invitation",
    requestSchema: WorkspaceInviteAcceptanceRequestV1Schema,
    requestRequired: true,
    responses: {
      "200": {
        description: "Trusted invite was accepted or had already been accepted",
        schema: WorkspaceInviteAcceptanceResponseV1Schema
      }
    }
  },
  {
    method: "GET",
    path: "/health",
    operationId: "healthCheck",
    summary: "Probe service readiness",
    responses: {
      "200": {
        description: "Service is live or its dependencies are ready",
        schema: HealthStatusV1Schema
      },
      "503": { description: "A checked dependency is unavailable", schema: HealthStatusV1Schema }
    }
  },
  {
    method: "POST",
    path: "/v1/workspaces/resolve-room",
    operationId: "resolveWorkspaceRoom",
    summary: "Resolve the active workspace bound to a Matrix room",
    requestSchema: WorkspaceRoomResolutionRequestV1Schema,
    requestRequired: true,
    responses: {
      "200": {
        description: "Active workspace binding found",
        schema: WorkspaceRoomResolutionResponseV1Schema
      },
      "404": { description: "No active workspace is bound to the Matrix room" }
    }
  }
];
