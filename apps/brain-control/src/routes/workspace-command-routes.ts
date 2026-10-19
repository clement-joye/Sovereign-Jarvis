import type { IncomingMessage, ServerResponse } from "node:http";

import { UnknownWorkspaceRoomError } from "@second-brain/application";
import {
  RoomAgentCommandRequestV1Schema,
  RoomAgentCommandResponseV1Schema,
  RoomLifecycleCommandRequestV1Schema,
  RoomLifecycleCommandResponseV1Schema,
  RoomPluginCommandRequestV1Schema,
  RoomPluginCommandResponseV1Schema
} from "@second-brain/contracts";

import type { WorkspaceRouteDependencies } from "./workspace-routes.js";

interface CommandRouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  dependencies: WorkspaceRouteDependencies;
}

export async function submitRoomAgentCommand(context: CommandRouteContext): Promise<boolean> {
  const { dependencies, request } = context;
  if (!dependencies.roomAgentCommands) return false;
  const parsed = RoomAgentCommandRequestV1Schema.safeParse(await dependencies.readJson(request));
  if (!parsed.success)
    return invalidCommand(context, "invalid_room_agent_command", parsed.error.issues);
  return submitResolvedCommand(context, parsed.data, {
    requireActive: false,
    submit: (message) => dependencies.roomAgentCommands!.submit(message),
    response: (handled) => RoomAgentCommandResponseV1Schema.parse({ handled })
  });
}

export async function submitRoomPluginCommand(context: CommandRouteContext): Promise<boolean> {
  const { dependencies, request } = context;
  if (!dependencies.roomPluginCommands) return false;
  const parsed = RoomPluginCommandRequestV1Schema.safeParse(await dependencies.readJson(request));
  if (!parsed.success)
    return invalidCommand(context, "invalid_room_plugin_command", parsed.error.issues);
  return submitResolvedCommand(context, parsed.data, {
    requireActive: true,
    inactiveError: "workspace_not_active",
    submit: (message) => dependencies.roomPluginCommands!.submit(message),
    response: (handled) => RoomPluginCommandResponseV1Schema.parse({ handled })
  });
}

export async function submitLifecycleCommand(context: CommandRouteContext): Promise<boolean> {
  const { dependencies, request } = context;
  if (!dependencies.roomLifecycleCommands) return false;
  const parsed = RoomLifecycleCommandRequestV1Schema.safeParse(
    await dependencies.readJson(request)
  );
  if (!parsed.success) {
    return invalidCommand(context, "invalid_room_lifecycle_command", parsed.error.issues);
  }
  return submitResolvedCommand(context, parsed.data, {
    requireActive: true,
    inactiveError: "workspace_not_commandable",
    submit: (message) => dependencies.roomLifecycleCommands!.submit(message),
    response: (handled) => RoomLifecycleCommandResponseV1Schema.parse({ handled })
  });
}

async function submitResolvedCommand(
  context: CommandRouteContext,
  input: {
    roomId: string;
    externalEventId: string;
    traceId: string;
    text: string;
    threadRootExternalEventId?: string | undefined;
  },
  policy: {
    requireActive: boolean;
    inactiveError?: string;
    submit(message: ReturnType<typeof matrixCommandMessage>): Promise<{ handled: boolean }>;
    response(handled: boolean): unknown;
  }
): Promise<true> {
  try {
    const workspace = await context.dependencies.workspaceResolution.resolveMatrixRoom(
      input.roomId
    );
    if (policy.requireActive && workspace.status !== "active") {
      context.dependencies.writeJson(context.response, 409, { error: policy.inactiveError });
      return true;
    }
    const submission = await policy.submit(matrixCommandMessage(input, workspace.id));
    context.dependencies.writeJson(context.response, 200, policy.response(submission.handled));
  } catch (error) {
    if (error instanceof UnknownWorkspaceRoomError) {
      context.dependencies.writeJson(context.response, 404, { error: "workspace_room_not_found" });
      return true;
    }
    throw error;
  }
  return true;
}

function matrixCommandMessage(
  input: {
    roomId: string;
    externalEventId: string;
    traceId: string;
    text: string;
    threadRootExternalEventId?: string | undefined;
  },
  workspaceId: string
) {
  return {
    schemaVersion: 1 as const,
    id: `matrix-${input.externalEventId}`,
    externalEventId: input.externalEventId,
    transport: "matrix" as const,
    conversationId: input.roomId,
    workspaceId,
    senderId: "matrix-gateway",
    kind: "command" as const,
    text: input.text,
    attachments: [],
    receivedAt: new Date().toISOString(),
    traceId: input.traceId,
    ...(input.threadRootExternalEventId
      ? { threadRootExternalEventId: input.threadRootExternalEventId }
      : {}),
    metadata: {}
  };
}

function invalidCommand(context: CommandRouteContext, error: string, issues: unknown): true {
  context.dependencies.writeJson(context.response, 400, { error, issues });
  return true;
}
