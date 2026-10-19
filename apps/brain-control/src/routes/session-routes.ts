import type { IncomingMessage, ServerResponse } from "node:http";

import type { SessionRepositoryPort } from "@second-brain/application";
import {
  SessionBindingActivateRequestV1Schema,
  SessionBindingLookupRequestV1Schema,
  SessionCreateAndBindRequestV1Schema,
  SessionCreateRequestV1Schema,
  type SessionBindingActivateRequestV1,
  type SessionBindingLookupRequestV1,
  type SessionCreateAndBindRequestV1,
  type SessionRecordV1
} from "@second-brain/contracts";
import type { SessionRecord } from "@second-brain/domain";

import { parseOpaquePathParameter } from "./path-parameters.js";

type ReadJson = (request: IncomingMessage) => Promise<unknown>;
type WriteJson = (response: ServerResponse, statusCode: number, body: unknown) => void;

export interface SessionRouteDependencies {
  sessions: SessionRepositoryPort;
  readJson: ReadJson;
  writeJson: WriteJson;
}

// handleSessionRoute is a single-purpose action dispatcher that
// intentionally keeps the list/get/create-and-bind/activate/touch/close
// branches together for readability. Splitting them into per-action
// files would scatter a cohesive unit. The complexity and length
// thresholds are advisory here — see eslint.config.js.
// eslint-disable-next-line complexity
export async function handleSessionRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  dependencies: SessionRouteDependencies
): Promise<boolean> {
  const method = request.method ?? "GET";
  const { readJson, sessions, writeJson } = dependencies;

  if (method === "GET" && url.pathname === "/v1/sessions") {
    writeJson(
      response,
      200,
      await sessions.listRecent({
        workspaceId: workspaceId(url),
        now: new Date(),
        limit: 25,
        includeClosed: true
      })
    );
    return true;
  }

  if (method === "POST" && url.pathname === "/v1/sessions/active-binding") {
    const parsed = SessionBindingLookupRequestV1Schema.safeParse(await readJson(request));
    if (!parsed.success) {
      writeJson(response, 400, {
        error: "invalid_session_binding_lookup_request",
        issues: parsed.error.issues
      });
      return true;
    }
    writeJson(
      response,
      200,
      (await sessions.getActiveBinding(sessionBindingLookup(parsed.data))) ?? null
    );
    return true;
  }

  if (method === "POST" && url.pathname === "/v1/sessions/bind") {
    const parsed = SessionCreateAndBindRequestV1Schema.safeParse(await readJson(request));
    if (!parsed.success) {
      writeJson(response, 400, {
        error: "invalid_session_bind_request",
        issues: parsed.error.issues
      });
      return true;
    }
    writeJson(
      response,
      201,
      await sessions.createAndBind(deserializeSessionBindingRequest(parsed.data))
    );
    return true;
  }

  if (method === "POST" && url.pathname === "/v1/sessions") {
    const parsed = SessionCreateRequestV1Schema.safeParse(await readJson(request));
    if (!parsed.success) {
      writeJson(response, 400, {
        error: "invalid_session_create_request",
        issues: parsed.error.issues
      });
      return true;
    }
    writeJson(response, 201, await sessions.create(deserializeSession(parsed.data)));
    return true;
  }

  if (method === "POST" && url.pathname === "/v1/sessions/activate") {
    const parsed = SessionBindingActivateRequestV1Schema.safeParse(await readJson(request));
    if (!parsed.success) {
      writeJson(response, 400, {
        error: "invalid_session_binding_activate_request",
        issues: parsed.error.issues
      });
      return true;
    }
    writeJson(response, 200, await sessions.activateBinding(sessionBindingActivation(parsed.data)));
    return true;
  }

  if (method === "GET" && url.pathname.startsWith("/v1/sessions/")) {
    const id = pathId(response, url.pathname.slice("/v1/sessions/".length), writeJson);
    if (id !== undefined) {
      const session = await sessions.get(id, workspaceId(url));
      writeJson(response, session ? 200 : 404, session ?? { error: "not_found" });
    }
    return true;
  }

  if (
    method === "POST" &&
    url.pathname.endsWith("/close") &&
    url.pathname.startsWith("/v1/sessions/")
  ) {
    const id = pathId(
      response,
      url.pathname.slice("/v1/sessions/".length, -"/close".length),
      writeJson
    );
    if (id !== undefined)
      writeJson(
        response,
        200,
        await sessions.close({ sessionId: id, workspaceId: workspaceId(url), now: new Date() })
      );
    return true;
  }

  if (
    method === "POST" &&
    url.pathname.endsWith("/touch") &&
    url.pathname.startsWith("/v1/sessions/")
  ) {
    const id = pathId(
      response,
      url.pathname.slice("/v1/sessions/".length, -"/touch".length),
      writeJson
    );
    if (id !== undefined)
      writeJson(
        response,
        200,
        await sessions.touch({ sessionId: id, workspaceId: workspaceId(url), now: new Date() })
      );
    return true;
  }

  return false;
}

function workspaceId(url: URL): string {
  const value = url.searchParams.get("workspaceId");
  if (!value) throw new Error("Session request requires workspaceId.");
  return value;
}

function pathId(
  response: ServerResponse,
  encodedValue: string | undefined,
  writeJson: WriteJson
): string | undefined {
  const id = parseOpaquePathParameter(encodedValue);
  if (id === undefined) writeJson(response, 400, { error: "invalid_path_parameter" });
  return id;
}

function deserializeSessionBindingRequest(
  input: SessionCreateAndBindRequestV1
): Parameters<SessionRepositoryPort["createAndBind"]>[0] {
  return {
    ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
    ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
    conversationId: input.conversationId,
    session: deserializeSession(input.session),
    ...(input.threadRootExternalEventId !== undefined
      ? { threadRootExternalEventId: input.threadRootExternalEventId }
      : {}),
    ...(input.scheduleId !== undefined ? { scheduleId: input.scheduleId } : {})
  };
}

function deserializeSession(session: SessionRecordV1): SessionRecord {
  return {
    id: session.id,
    ...(session.workspaceId !== undefined ? { workspaceId: session.workspaceId } : {}),
    ...(session.label !== undefined ? { label: session.label } : {}),
    status: session.status,
    createdAt: new Date(session.createdAt),
    lastActiveAt: new Date(session.lastActiveAt),
    idleExpiresAt: new Date(session.idleExpiresAt),
    absoluteExpiresAt: new Date(session.absoluteExpiresAt),
    piSessionKey: session.piSessionKey,
    sourceType: session.sourceType,
    ...(session.sourceConversationId !== undefined
      ? { sourceConversationId: session.sourceConversationId }
      : {}),
    ...(session.sourceThreadRootId !== undefined
      ? { sourceThreadRootId: session.sourceThreadRootId }
      : {}),
    ...(session.sourceScheduleId !== undefined
      ? { sourceScheduleId: session.sourceScheduleId }
      : {})
  };
}

function sessionBindingLookup(
  input: SessionBindingLookupRequestV1
): Parameters<SessionRepositoryPort["getActiveBinding"]>[0] {
  return {
    ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
    ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
    conversationId: input.conversationId,
    ...(input.threadRootExternalEventId !== undefined
      ? { threadRootExternalEventId: input.threadRootExternalEventId }
      : {}),
    ...(input.scheduleId !== undefined ? { scheduleId: input.scheduleId } : {})
  };
}

function sessionBindingActivation(
  input: SessionBindingActivateRequestV1
): Parameters<SessionRepositoryPort["activateBinding"]>[0] {
  return { sessionId: input.sessionId, ...sessionBindingLookup(input) };
}
