import type { IncomingMessage, ServerResponse } from "node:http";

import type { SessionRoutingService } from "@second-brain/application";
import type { ConversationPreferencePort } from "@second-brain/application";
import {
  ConversationSessionContextRequestV1Schema,
  ConversationVoicePreferenceRequestV1Schema,
  InboundMessageV1Schema
} from "@second-brain/contracts";

type ReadJson = (request: IncomingMessage) => Promise<unknown>;
type WriteJson = (response: ServerResponse, statusCode: number, body: unknown) => void;

export interface ConversationRouteDependencies {
  sessionRouting: SessionRoutingService;
  preferences: ConversationPreferencePort;
  readJson: ReadJson;
  writeJson: WriteJson;
}

export async function handleConversationRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  dependencies: ConversationRouteDependencies
): Promise<boolean> {
  const method = request.method ?? "GET";
  const { readJson, sessionRouting, writeJson } = dependencies;

  if (method === "POST" && url.pathname === "/v1/session-routing/matrix") {
    const parsed = InboundMessageV1Schema.safeParse(await readJson(request));
    if (!parsed.success) {
      writeJson(response, 400, { error: "invalid_inbound_message", issues: parsed.error.issues });
      return true;
    }
    writeJson(response, 200, await sessionRouting.routeInbound(parsed.data));
    return true;
  }

  if (method !== "POST") return false;
  if (url.pathname === "/v1/conversation-preferences/session-context") {
    return handleSessionContextPreference(request, response, dependencies);
  }
  if (url.pathname !== "/v1/conversation-preferences/voice") return false;
  return handleVoicePreference(request, response, dependencies);
}

async function handleVoicePreference(
  request: IncomingMessage,
  response: ServerResponse,
  { preferences, readJson, writeJson }: ConversationRouteDependencies
): Promise<true> {
  const parsed = ConversationVoicePreferenceRequestV1Schema.safeParse(await readJson(request));
  if (!parsed.success) {
    writeJson(response, 400, {
      error: "invalid_conversation_preference",
      issues: parsed.error.issues
    });
    return true;
  }
  const input = {
    ...(parsed.data.workspaceId !== undefined ? { workspaceId: parsed.data.workspaceId } : {}),
    conversationId: parsed.data.conversationId,
    ...(parsed.data.threadRootExternalEventId !== undefined
      ? { threadRootExternalEventId: parsed.data.threadRootExternalEventId }
      : {})
  };
  const enabled =
    parsed.data.enabled === undefined
      ? await preferences.getVoiceReplies(input)
      : await preferences.setVoiceReplies({ ...input, enabled: parsed.data.enabled });
  writeJson(response, 200, { enabled });
  return true;
}

async function handleSessionContextPreference(
  request: IncomingMessage,
  response: ServerResponse,
  { preferences, readJson, writeJson }: ConversationRouteDependencies
): Promise<true> {
  const parsed = ConversationSessionContextRequestV1Schema.safeParse(await readJson(request));
  if (!parsed.success) {
    writeJson(response, 400, { error: "invalid_session_context", issues: parsed.error.issues });
    return true;
  }
  const { mode, historyLimit, ...scope } = parsed.data;
  const preferenceScope = {
    conversationId: scope.conversationId,
    ...(scope.workspaceId ? { workspaceId: scope.workspaceId } : {}),
    ...(scope.threadRootExternalEventId
      ? { threadRootExternalEventId: scope.threadRootExternalEventId }
      : {})
  };
  const isUpdate = mode !== undefined || historyLimit !== undefined;
  const value = isUpdate
    ? await preferences.setSessionContext?.({
        ...preferenceScope,
        ...(mode ? { mode } : {}),
        ...(historyLimit !== null && historyLimit !== undefined ? { historyLimit } : {})
      })
    : await preferences.getSessionContext?.(preferenceScope);
  writeJson(response, 200, value ?? {});
  return true;
}
