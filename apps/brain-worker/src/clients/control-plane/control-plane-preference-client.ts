import type {
  ConversationPreferencePort,
  SessionContextPreference
} from "@second-brain/application";
import {
  ConversationSessionContextResponseV1Schema,
  ConversationVoicePreferenceResponseV1Schema
} from "@second-brain/contracts";

import { requestJson } from "../../http/http-json-client.js";

export class HttpConversationPreferenceRepository implements ConversationPreferencePort {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number | undefined = undefined
  ) {}

  async getVoiceReplies(input: {
    workspaceId?: string;
    conversationId: string;
    threadRootExternalEventId?: string;
  }): Promise<boolean> {
    return this.request(input);
  }

  async setVoiceReplies(input: {
    workspaceId?: string;
    conversationId: string;
    threadRootExternalEventId?: string;
    enabled: boolean;
  }): Promise<boolean> {
    return this.request(input);
  }

  async getSessionContext(input: {
    workspaceId?: string;
    conversationId: string;
    threadRootExternalEventId?: string;
  }): Promise<SessionContextPreference> {
    return this.requestSessionContext(input);
  }

  async setSessionContext(input: {
    workspaceId?: string;
    conversationId: string;
    threadRootExternalEventId?: string;
    mode?: "persistent";
    historyLimit?: number;
  }): Promise<SessionContextPreference> {
    return this.requestSessionContext({
      ...input,
      mode: input.mode ?? null,
      historyLimit: input.historyLimit ?? null
    });
  }

  private async request(body: unknown): Promise<boolean> {
    const path = "/v1/conversation-preferences/voice";
    const response = await requestJson({
      baseUrl: this.baseUrl,
      path,
      method: "POST",
      body,
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      parse: (response) => ConversationVoicePreferenceResponseV1Schema.parse(response)
    });
    return response.enabled;
  }

  private requestSessionContext(body: unknown): Promise<SessionContextPreference> {
    return requestJson({
      baseUrl: this.baseUrl,
      path: "/v1/conversation-preferences/session-context",
      method: "POST",
      body,
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      parse: (response) => ConversationSessionContextResponseV1Schema.parse(response)
    });
  }
}
