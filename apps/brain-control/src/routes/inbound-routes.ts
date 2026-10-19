import type { IncomingMessage, ServerResponse } from "node:http";

import {
  type InboundAcceptanceResult,
  type InboundMessageRepositoryPort,
  UnknownWorkspaceRoomError,
  type WorkspaceResolutionService
} from "@second-brain/application";
import {
  InboundAudioTranscriptRequestV1Schema,
  InboundMessageV1Schema,
  type InboundMessageV1
} from "@second-brain/contracts";
import { selectExplicitAgent, type AgentCatalog } from "@second-brain/domain";

import { parseOpaquePathParameter } from "./path-parameters.js";

type ReadJson = (request: IncomingMessage) => Promise<unknown>;
type WriteJson = (response: ServerResponse, statusCode: number, body: unknown) => void;

export interface InboundAcceptancePort {
  acceptMatrixInbound(message: InboundMessageV1): Promise<InboundAcceptanceResult>;
}

export interface InboundRouteDependencies {
  inboundAcceptance: InboundAcceptancePort;
  inboundMessages: InboundMessageRepositoryPort;
  agentCatalog: AgentCatalog;
  workspaceResolution?: WorkspaceResolutionService;
  cancelPiRun?: (workspaceId: string, runId: string) => Promise<void>;
  readJson: ReadJson;
  writeJson: WriteJson;
}

export async function handleInboundRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  dependencies: InboundRouteDependencies
): Promise<boolean> {
  const method = request.method ?? "GET";
  if (method === "POST" && url.pathname === "/v1/inbound/matrix") {
    return acceptMatrixInbound(request, response, dependencies);
  }
  if (method === "PUT") {
    const transcriptId = url.pathname.match(/^\/v1\/inbound\/([^/]+)\/audio-transcript$/)?.[1];
    return transcriptId
      ? saveAudioTranscript(request, response, transcriptId, dependencies)
      : false;
  }
  if (method !== "GET" || !url.pathname.startsWith("/v1/inbound/")) return false;
  const historyId = url.pathname.match(/^\/v1\/inbound\/([^/]+)\/thread-history$/)?.[1];
  return historyId
    ? getThreadHistory(response, url, historyId, dependencies)
    : getInboundMessage(response, url.pathname.slice("/v1/inbound/".length), dependencies);
}

async function saveAudioTranscript(
  request: IncomingMessage,
  response: ServerResponse,
  encodedId: string,
  dependencies: InboundRouteDependencies
): Promise<true> {
  const id = parseOpaquePathParameter(encodedId);
  const parsed = InboundAudioTranscriptRequestV1Schema.safeParse(
    await dependencies.readJson(request)
  );
  if (id === undefined || !parsed.success) {
    dependencies.writeJson(response, 400, { error: "invalid_audio_transcript" });
    return true;
  }
  const message = await dependencies.inboundMessages.get(id);
  if (!message || message.workspaceId !== parsed.data.workspaceId || message.kind !== "audio") {
    dependencies.writeJson(response, 404, { error: "audio_message_not_found" });
    return true;
  }
  await dependencies.inboundMessages.saveAudioTranscript({ id, ...parsed.data });
  dependencies.writeJson(response, 200, { stored: true });
  return true;
}

async function acceptMatrixInbound(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: InboundRouteDependencies
): Promise<true> {
  const parsed = InboundMessageV1Schema.safeParse(await dependencies.readJson(request));
  if (!parsed.success) {
    dependencies.writeJson(response, 400, {
      error: "invalid_inbound_message",
      issues: parsed.error.issues
    });
    return true;
  }
  const message = selectExplicitAgent(parsed.data, dependencies.agentCatalog) ?? parsed.data;
  if (!(await workspaceOwnershipAccepted(message, response, dependencies))) return true;
  const accepted = await dependencies.inboundAcceptance.acceptMatrixInbound(message);
  if (
    accepted.cancelTargetRunId &&
    accepted.cancelTargetNeedsPiCancel &&
    message.workspaceId &&
    dependencies.cancelPiRun
  ) {
    await dependencies.cancelPiRun(message.workspaceId, accepted.cancelTargetRunId);
  }
  const {
    cancelTargetRunId: _cancelTargetRunId,
    cancelTargetNeedsPiCancel: _cancelTargetNeedsPiCancel,
    ...publicResult
  } = accepted;
  dependencies.writeJson(response, 202, publicResult);
  return true;
}

async function workspaceOwnershipAccepted(
  message: InboundMessageV1,
  response: ServerResponse,
  dependencies: InboundRouteDependencies
): Promise<boolean> {
  if (!message.workspaceId || !dependencies.workspaceResolution) return true;
  try {
    const workspace = await dependencies.workspaceResolution.resolveMatrixRoom(
      message.conversationId
    );
    if (workspace.id !== message.workspaceId) {
      dependencies.writeJson(response, 403, { error: "workspace_room_mismatch" });
      return false;
    }
    if (message.agentId) {
      await dependencies.workspaceResolution.setThreadAgent({
        workspaceId: workspace.id,
        conversationId: message.conversationId,
        threadRootExternalEventId: message.threadRootExternalEventId ?? message.externalEventId,
        agentId: message.agentId,
        updatedAt: new Date()
      });
    }
    return true;
  } catch (error) {
    if (!(error instanceof UnknownWorkspaceRoomError)) throw error;
    dependencies.writeJson(response, 403, { error: "workspace_room_not_found" });
    return false;
  }
}

async function getThreadHistory(
  response: ServerResponse,
  url: URL,
  encodedId: string,
  dependencies: InboundRouteDependencies
): Promise<true> {
  const id = parseOpaquePathParameter(encodedId);
  if (id === undefined) {
    dependencies.writeJson(response, 400, { error: "invalid_path_parameter" });
    return true;
  }
  const message = await dependencies.inboundMessages.get(id);
  if (!message) {
    dependencies.writeJson(response, 404, { error: "not_found" });
    return true;
  }
  if (!dependencies.inboundMessages.listThreadHistory) {
    dependencies.writeJson(response, 501, { error: "thread_history_unavailable" });
    return true;
  }
  dependencies.writeJson(
    response,
    200,
    await dependencies.inboundMessages.listThreadHistory({ message, limit: historyLimit(url) })
  );
  return true;
}

async function getInboundMessage(
  response: ServerResponse,
  encodedId: string,
  dependencies: InboundRouteDependencies
): Promise<true> {
  const id = parseOpaquePathParameter(encodedId);
  if (id === undefined) {
    dependencies.writeJson(response, 400, { error: "invalid_path_parameter" });
    return true;
  }
  const message = await dependencies.inboundMessages.get(id);
  dependencies.writeJson(response, message ? 200 : 404, message ?? { error: "not_found" });
  return true;
}

function historyLimit(url: URL): number {
  const requested = Number(url.searchParams.get("limit") ?? "12");
  return Number.isInteger(requested) ? Math.max(1, Math.min(requested, 20)) : 12;
}
