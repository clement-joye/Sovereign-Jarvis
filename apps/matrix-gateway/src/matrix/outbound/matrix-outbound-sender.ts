import type { FileAttachmentStore } from "@second-brain/media-adapter";
import type {
  AttachmentReferenceV1,
  OutboundMessageV1,
  StructuredErrorV1
} from "@second-brain/contracts";
import {
  matrixRelation,
  matrixTransactionId,
  toMatrixTextOutbound
} from "@second-brain/matrix-adapter";

import type { MatrixE2eeClient } from "../sessions/matrix-e2ee-client.js";
import type { MatrixMediaClient } from "../media/matrix-media.js";

export interface MatrixOutboundSender {
  send(message: OutboundMessageV1): Promise<{ externalEventId: string }>;
}

class MatrixMessageContentBuilder {
  constructor(
    private readonly media: MatrixMediaClient,
    private readonly attachments: FileAttachmentStore
  ) {}

  async build(message: OutboundMessageV1): Promise<Record<string, unknown>> {
    assertSingleMatrixEvent(message);
    if (message.audio) return this.upload(message, message.audio, "m.audio");
    if (message.images[0]) return this.upload(message, message.images[0], "m.image");
    if (message.files?.[0]) return this.upload(message, message.files[0], "m.file");
    return { ...toMatrixTextOutbound(message) };
  }

  private async upload(
    message: OutboundMessageV1,
    attachment: AttachmentReferenceV1,
    msgtype: "m.audio" | "m.image" | "m.file"
  ): Promise<Record<string, unknown>> {
    const uploaded = await this.media.upload({
      bytes: await this.attachments.open(attachment.storageKey),
      mediaType: attachment.mediaType,
      filename: attachment.originalFilename ?? defaultFilename(attachment.id, msgtype)
    });
    const relation = matrixRelation(message);
    return {
      msgtype,
      body: attachment.originalFilename ?? attachment.id,
      url: uploaded.contentUri,
      info: {
        mimetype: attachment.mediaType,
        size: attachment.sizeBytes,
        ...(attachment.durationMs === undefined ? {} : { duration: attachment.durationMs }),
        ...(attachment.width === undefined ? {} : { w: attachment.width }),
        ...(attachment.height === undefined ? {} : { h: attachment.height })
      },
      ...(relation ? { "m.relates_to": relation } : {})
    };
  }
}

export class MatrixRoomHttpSender implements MatrixOutboundSender {
  private readonly content: MatrixMessageContentBuilder;

  constructor(
    private readonly homeserverUrl: string,
    private readonly accessToken: string,
    media: MatrixMediaClient,
    attachments: FileAttachmentStore
  ) {
    this.content = new MatrixMessageContentBuilder(media, attachments);
  }

  async send(message: OutboundMessageV1): Promise<{ externalEventId: string }> {
    const roomId = encodeURIComponent(message.conversationId);
    const txnId = encodeURIComponent(matrixTransactionId(message));
    const response = await fetch(
      `${this.homeserverUrl.replace(/\/$/, "")}/_matrix/client/v3/rooms/${roomId}/send/m.room.message/${txnId}`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(await this.content.build(message))
      }
    );
    if (!response.ok) {
      throw new MatrixSendError(
        `Matrix send failed with HTTP ${response.status}.`,
        response.status >= 500 || response.status === 429
      );
    }
    const body = (await response.json()) as { event_id?: string };
    if (!body.event_id) throw new MatrixSendError("Matrix send response omitted event_id.", true);
    return { externalEventId: body.event_id };
  }
}

export class MatrixSdkRoomSender implements MatrixOutboundSender {
  private readonly content: MatrixMessageContentBuilder;

  constructor(
    private readonly client: MatrixE2eeClient,
    media: MatrixMediaClient,
    attachments: FileAttachmentStore
  ) {
    this.content = new MatrixMessageContentBuilder(media, attachments);
  }

  async send(message: OutboundMessageV1): Promise<{ externalEventId: string }> {
    const result = await this.client.sendMessage(
      message.conversationId,
      await this.content.build(message),
      matrixTransactionId(message)
    );
    return { externalEventId: result.event_id };
  }
}

export class DeterministicMatrixSender implements MatrixOutboundSender {
  async send(message: OutboundMessageV1): Promise<{ externalEventId: string }> {
    if (!message.text) throw new MatrixSendError("Only text messages can be delivered.", false);
    return { externalEventId: `$${matrixTransactionId(message)}` };
  }
}

export function deliveryError(error: unknown): StructuredErrorV1 {
  const retryable =
    error instanceof MatrixSendError
      ? error.retryable
      : !(error instanceof Error && "retryable" in error && error.retryable === false);
  return {
    schemaVersion: 1,
    code: retryable ? "matrix_delivery_retry" : "matrix_delivery_failed",
    category: retryable ? "dependency" : "validation",
    message: error instanceof Error ? error.message : "Unknown Matrix delivery error.",
    retryable
  };
}

class MatrixSendError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
  }
}

function assertSingleMatrixEvent(message: OutboundMessageV1): void {
  const payloads =
    Number(Boolean(message.text)) +
    Number(Boolean(message.audio)) +
    message.images.length +
    (message.files?.length ?? 0);
  if (payloads !== 1) {
    throw new MatrixSendError("Each Matrix event must contain exactly one primary payload.", false);
  }
}

function defaultFilename(id: string, msgtype: "m.audio" | "m.image" | "m.file"): string {
  const extension = msgtype === "m.audio" ? "ogg" : msgtype === "m.image" ? "png" : "bin";
  return `${id}.${extension}`;
}
