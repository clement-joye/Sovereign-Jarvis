import type { AttachmentReferenceV1, OutboundMessageV1 } from "@second-brain/contracts";
import { requireWorkspaceId, type IdGeneratorPort } from "@second-brain/domain";

import type { OutboundRepositoryPort } from "../ports.js";

export interface OutboundResponseInput {
  idempotencyKey: string;
  traceId: string;
  conversationId: string;
  workspaceId?: string;
  text?: string;
  audio?: AttachmentReferenceV1;
  images?: AttachmentReferenceV1[];
  files?: AttachmentReferenceV1[];
  replyToExternalEventId?: string;
  threadRootExternalEventId?: string;
  threadAnchorText?: string;
  presentation?: OutboundMessageV1["presentation"];
}

/** Builds idempotent outbound messages independently from worker job completion. */
export class OutboundResponseFactory {
  constructor(
    private readonly outbounds: OutboundRepositoryPort,
    private readonly ids: IdGeneratorPort
  ) {}

  getByIdempotencyKey(
    idempotencyKey: string,
    workspaceId?: string
  ): Promise<OutboundMessageV1 | undefined> {
    return this.outbounds.getByIdempotencyKey(idempotencyKey, workspaceId);
  }

  async getOrBuild(input: OutboundResponseInput): Promise<OutboundMessageV1> {
    const workspaceId = requireWorkspaceId(input.workspaceId, "Outbound response");
    const existing = await this.getByIdempotencyKey(input.idempotencyKey, workspaceId);
    if (existing) return existing;

    return {
      schemaVersion: 1,
      id: this.ids.nextId("outbound"),
      traceId: input.traceId,
      conversationId: input.conversationId,
      workspaceId,
      ...(input.text ? { text: input.text } : {}),
      ...(input.audio ? { audio: input.audio } : {}),
      images: input.images ?? [],
      files: input.files ?? [],
      ...(input.replyToExternalEventId
        ? { replyToExternalEventId: input.replyToExternalEventId }
        : {}),
      ...(input.threadRootExternalEventId
        ? { threadRootExternalEventId: input.threadRootExternalEventId }
        : {}),
      ...(input.threadAnchorText ? { threadAnchorText: input.threadAnchorText } : {}),
      presentation: input.presentation ?? "assistant",
      urgency: "normal",
      idempotencyKey: input.idempotencyKey
    };
  }

  create(message: OutboundMessageV1): Promise<OutboundMessageV1> {
    return this.outbounds.create(message);
  }
}
