import type { InboundMessageRepositoryPort } from "@second-brain/application";
import {
  InboundMessageV1Schema,
  ThreadHistoryItemV1Schema,
  type InboundMessageV1,
  type ThreadHistoryItemV1
} from "@second-brain/contracts";

import { requestJson, requestOptionalJson } from "../../http/http-json-client.js";

export class HttpInboundMessageRepository implements InboundMessageRepositoryPort {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number | undefined = undefined
  ) {}

  async create(): Promise<never> {
    throw new Error("Brain worker does not accept inbound messages.");
  }

  async get(id: string): Promise<InboundMessageV1 | undefined> {
    return requestOptionalJson({
      baseUrl: this.baseUrl,
      path: `/v1/inbound/${encodeURIComponent(id)}`,
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      parse: (response) => InboundMessageV1Schema.parse(response)
    });
  }

  async getByTransportEvent(): Promise<InboundMessageV1 | undefined> {
    throw new Error("Brain worker does not query inbound messages by transport event.");
  }

  async saveAudioTranscript(input: {
    id: string;
    workspaceId: string;
    text: string;
  }): Promise<void> {
    await requestJson({
      baseUrl: this.baseUrl,
      path: `/v1/inbound/${encodeURIComponent(input.id)}/audio-transcript`,
      method: "PUT",
      body: { workspaceId: input.workspaceId, text: input.text },
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      parse: (response) => response
    });
  }

  async listThreadHistory(input: {
    message: InboundMessageV1;
    limit: number;
  }): Promise<ThreadHistoryItemV1[]> {
    const history = await requestOptionalJson({
      baseUrl: this.baseUrl,
      path: `/v1/inbound/${encodeURIComponent(input.message.id)}/thread-history?limit=${input.limit}`,
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      parse: (response) => ThreadHistoryItemV1Schema.array().parse(response)
    });
    return history ?? [];
  }
}
