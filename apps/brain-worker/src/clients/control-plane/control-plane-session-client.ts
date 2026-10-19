import type { SessionRepositoryPort } from "@second-brain/application";
import { SessionRecordV1Schema, type SessionRecordV1 } from "@second-brain/contracts";
import { requireWorkspaceId, type RoomAgentId, type SessionRecord } from "@second-brain/domain";

import { requestJson, requestOptionalJson } from "../../http/http-json-client.js";

export class HttpSessionRepository implements SessionRepositoryPort {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number | undefined = undefined
  ) {}

  async getActiveBinding(input: {
    workspaceId?: string;
    agentId?: RoomAgentId;
    conversationId: string;
    threadRootExternalEventId?: string;
    scheduleId?: string;
  }): Promise<SessionRecord | undefined> {
    const result = await this.post("/v1/sessions/active-binding", input, (body) =>
      SessionRecordV1Schema.nullable().parse(body)
    );
    return result === null ? undefined : deserializeSession(result);
  }

  async create(session: SessionRecord): Promise<SessionRecord> {
    return deserializeSession(
      await this.post("/v1/sessions", serializeSession(session), (body) =>
        SessionRecordV1Schema.parse(body)
      )
    );
  }

  async createAndBind(input: {
    session: SessionRecord;
    workspaceId?: string;
    agentId?: RoomAgentId;
    conversationId: string;
    threadRootExternalEventId?: string;
    scheduleId?: string;
  }): Promise<SessionRecord> {
    return deserializeSession(
      await this.post(
        "/v1/sessions/bind",
        {
          ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
          ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
          conversationId: input.conversationId,
          session: serializeSession(input.session),
          ...(input.threadRootExternalEventId !== undefined
            ? { threadRootExternalEventId: input.threadRootExternalEventId }
            : {}),
          ...(input.scheduleId !== undefined ? { scheduleId: input.scheduleId } : {})
        },
        (body) => SessionRecordV1Schema.parse(body)
      )
    );
  }

  async activateBinding(input: {
    sessionId: string;
    workspaceId?: string;
    agentId?: RoomAgentId;
    conversationId: string;
    threadRootExternalEventId?: string;
    scheduleId?: string;
  }): Promise<SessionRecord> {
    return deserializeSession(
      await this.post("/v1/sessions/activate", input, (body) => SessionRecordV1Schema.parse(body))
    );
  }

  async get(id: string, workspaceId?: string): Promise<SessionRecord | undefined> {
    const result = await this.getOptional(
      `/v1/sessions/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(requireWorkspaceId(workspaceId, "Session lookup"))}`
    );
    return result === undefined ? undefined : deserializeSession(result);
  }

  async listRecent(input: {
    workspaceId?: string;
    now: Date;
    limit: number;
    includeClosed: boolean;
  }): Promise<SessionRecord[]> {
    const records = await this.getRequired(
      `/v1/sessions?workspaceId=${encodeURIComponent(requireWorkspaceId(input.workspaceId, "Session listing"))}`,
      (body) => SessionRecordV1Schema.array().parse(body)
    );
    return records
      .map(deserializeSession)
      .filter((session) => input.includeClosed || session.status !== "closed")
      .slice(0, input.limit);
  }

  async touch(input: {
    sessionId: string;
    workspaceId?: string;
    now: Date;
  }): Promise<SessionRecord> {
    return deserializeSession(
      await this.post(
        `/v1/sessions/${encodeURIComponent(input.sessionId)}/touch?workspaceId=${encodeURIComponent(requireWorkspaceId(input.workspaceId, "Session touch"))}`,
        {},
        (body) => SessionRecordV1Schema.parse(body)
      )
    );
  }

  async close(input: {
    sessionId: string;
    workspaceId?: string;
    now: Date;
  }): Promise<SessionRecord> {
    return deserializeSession(
      await this.post(
        `/v1/sessions/${encodeURIComponent(input.sessionId)}/close?workspaceId=${encodeURIComponent(requireWorkspaceId(input.workspaceId, "Session close"))}`,
        {},
        (body) => SessionRecordV1Schema.parse(body)
      )
    );
  }

  private async getOptional(path: string): Promise<SessionRecordV1 | undefined> {
    return requestOptionalJson({
      baseUrl: this.baseUrl,
      path,
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      parse: (response) => SessionRecordV1Schema.parse(response)
    });
  }

  private async getRequired<T>(path: string, parse: (body: unknown) => T): Promise<T> {
    return requestJson({
      baseUrl: this.baseUrl,
      path,
      method: "GET",
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      parse
    });
  }

  private async post<T>(path: string, body: unknown, parse: (response: unknown) => T): Promise<T> {
    return requestJson({
      baseUrl: this.baseUrl,
      path,
      method: "POST",
      body,
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      parse
    });
  }
}

function serializeSession(session: SessionRecord): SessionRecordV1 {
  return {
    id: session.id,
    ...(session.workspaceId !== undefined ? { workspaceId: session.workspaceId } : {}),
    ...(session.label !== undefined ? { label: session.label } : {}),
    status: session.status,
    createdAt: session.createdAt.toISOString(),
    lastActiveAt: session.lastActiveAt.toISOString(),
    idleExpiresAt: session.idleExpiresAt.toISOString(),
    absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
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
