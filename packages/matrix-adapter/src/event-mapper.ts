import type { AttachmentReferenceV1, InboundMessageV1 } from "@second-brain/contracts";

export interface MatrixTextEventMapperOptions {
  now?: () => Date;
}

export class MatrixTextEventMapper {
  private readonly now: () => Date;

  constructor(options: MatrixTextEventMapperOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  toInboundMessage(event: unknown): InboundMessageV1 {
    const parsed = parseMatrixTextEvent(event);
    const content = effectiveContent(parsed.content);
    const rawBody = typeof content.body === "string" ? content.body : undefined;
    const receivedAt =
      typeof parsed.origin_server_ts === "number"
        ? new Date(parsed.origin_server_ts).toISOString()
        : this.now().toISOString();
    const relatesTo = getRelatesTo(parsed.content);
    const body = rawBody ? replyBody(rawBody, relatesTo.replyTo !== undefined) : undefined;
    const attachment = toAttachment(parsed, content);
    const kind = toInboundKind(content, body);

    return {
      schemaVersion: 1,
      id: stableMatrixScopedId("inbound", parsed.event_id),
      traceId: stableMatrixScopedId("trace", parsed.event_id),
      transport: "matrix",
      externalEventId: parsed.event_id,
      conversationId: parsed.room_id,
      senderId: parsed.sender,
      receivedAt,
      kind,
      ...(body && !attachment ? { text: body } : {}),
      ...(attachment && typeof storedAttachmentText(content) === "string"
        ? { text: storedAttachmentText(content)! }
        : {}),
      attachments: attachment ? [attachment] : [],
      replyToExternalEventId: relatesTo.replyTo,
      threadRootExternalEventId: relatesTo.threadRoot,
      replacesExternalEventId: relatesTo.replaces,
      metadata: {
        matrixMessageType: content.msgtype,
        matrixEventType: parsed.type
      }
    };
  }
}

/** Removes the standard plain-text Matrix reply fallback retained by some clients. */
function replyBody(body: string, isReply: boolean): string {
  if (!isReply || !body.startsWith(">")) return body;
  const separator = body.indexOf("\n\n");
  if (separator < 0) return body;
  const fallback = body.slice(0, separator).split("\n");
  return fallback.every((line) => line.startsWith(">")) ? body.slice(separator + 2) : body;
}

export interface MatrixEventMapper {
  toInboundMessage(event: unknown): InboundMessageV1;
}

interface ParsedMatrixTextEvent {
  type: "m.room.message";
  event_id: string;
  room_id: string;
  sender: string;
  origin_server_ts?: number;
  content: Record<string, unknown>;
}

function parseMatrixTextEvent(event: unknown): ParsedMatrixTextEvent {
  if (!isRecord(event)) {
    throw new Error("Matrix event must be an object.");
  }
  if (event.type !== "m.room.message") {
    throw new Error("Only m.room.message events are supported.");
  }

  const content = getRecord(event.content, "content");
  const effective = effectiveContent(content);
  if (
    effective.msgtype !== "m.text" &&
    effective.msgtype !== "m.notice" &&
    effective.msgtype !== "m.image" &&
    effective.msgtype !== "m.audio" &&
    effective.msgtype !== "m.file"
  ) {
    throw new Error(`Unsupported Matrix msgtype: ${String(effective.msgtype)}`);
  }

  return {
    type: "m.room.message",
    event_id: getString(event.event_id, "event_id"),
    room_id: getString(event.room_id, "room_id"),
    sender: getString(event.sender, "sender"),
    ...(typeof event.origin_server_ts === "number"
      ? { origin_server_ts: event.origin_server_ts }
      : {}),
    content
  };
}

function toInboundKind(
  content: Record<string, unknown>,
  body: string | undefined
): InboundMessageV1["kind"] {
  if (content.msgtype === "m.image") {
    return "image";
  }
  if (content.msgtype === "m.audio") {
    return "audio";
  }
  if (content.msgtype === "m.file") return "document";
  return body?.trimStart().startsWith("/") ? "command" : "text";
}

function toAttachment(
  event: ParsedMatrixTextEvent,
  content: Record<string, unknown>
): AttachmentReferenceV1 | undefined {
  if (
    content.msgtype !== "m.image" &&
    content.msgtype !== "m.audio" &&
    content.msgtype !== "m.file"
  ) {
    return undefined;
  }

  const info = recordOrEmpty(content.info);
  const stored = recordOrEmpty(content["org.second-brain.stored_attachment"]);
  const matrixUrl = getString(content.url, "content.url");

  return {
    schemaVersion: 1,
    id: stableMatrixScopedId("attachment", `${event.event_id}:${matrixUrl}`),
    purpose: "inbound",
    mediaType: attachmentMediaType(content.msgtype, info),
    sizeBytes: attachmentSizeBytes(stored, info),
    sha256: typeof stored.sha256 === "string" ? stored.sha256 : "0".repeat(64),
    storageKey: attachmentStorageKey(event.event_id, matrixUrl, stored),
    ...(typeof content.body === "string" ? { originalFilename: content.body } : {}),
    ...attachmentDimensions(info)
  };
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function storedAttachmentText(content: Record<string, unknown>): string | undefined {
  const stored = recordOrEmpty(content["org.second-brain.stored_attachment"]);
  return typeof stored.text_excerpt === "string" && stored.text_excerpt.length > 0
    ? stored.text_excerpt
    : undefined;
}

function attachmentMediaType(
  msgtype: "m.image" | "m.audio" | "m.file",
  info: Record<string, unknown>
): string {
  if (typeof info.mimetype === "string") return info.mimetype;
  return msgtype === "m.image"
    ? "image/jpeg"
    : msgtype === "m.audio"
      ? "audio/ogg"
      : "application/octet-stream";
}

function attachmentSizeBytes(
  stored: Record<string, unknown>,
  info: Record<string, unknown>
): number {
  return nonNegativeInteger(stored.size_bytes) ?? nonNegativeInteger(info.size) ?? 0;
}

function attachmentStorageKey(
  eventId: string,
  matrixUrl: string,
  stored: Record<string, unknown>
): string {
  if (typeof stored.storage_key === "string") return stored.storage_key;
  return `matrix/${Buffer.from(eventId).toString("base64url")}/${Buffer.from(matrixUrl).toString("base64url")}`;
}

function attachmentDimensions(info: Record<string, unknown>): Partial<AttachmentReferenceV1> {
  const durationMs = truncatedNumber(info.duration);
  const width = truncatedNumber(info.w);
  const height = truncatedNumber(info.h);
  return {
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {})
  };
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && value >= 0 ? Math.trunc(value) : undefined;
}

function truncatedNumber(value: unknown): number | undefined {
  return typeof value === "number" ? Math.trunc(value) : undefined;
}

function effectiveContent(content: Record<string, unknown>): Record<string, unknown> {
  const replacement = getRelatesTo(content).replaces;
  if (replacement) {
    const newContent = content["m.new_content"];
    if (isRecord(newContent)) {
      return newContent;
    }
  }
  return content;
}

function getRelatesTo(content: Record<string, unknown>): {
  replyTo?: string;
  threadRoot?: string;
  replaces?: string;
} {
  const relatesTo = content["m.relates_to"];
  if (!isRecord(relatesTo)) {
    return {};
  }

  const reply = relatesTo["m.in_reply_to"];
  const replyTo =
    isRecord(reply) && typeof reply.event_id === "string" ? reply.event_id : undefined;
  const relType = relatesTo.rel_type;
  const relatedEventId = typeof relatesTo.event_id === "string" ? relatesTo.event_id : undefined;

  return {
    ...(replyTo ? { replyTo } : {}),
    ...(relType === "m.thread" && relatedEventId ? { threadRoot: relatedEventId } : {}),
    ...(relType === "m.replace" && relatedEventId ? { replaces: relatedEventId } : {})
  };
}

export function stableMatrixScopedId(prefix: string, matrixId: string): string {
  return `${prefix}-${Buffer.from(matrixId).toString("base64url")}`;
}

function getString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Matrix ${field} must be a non-empty string.`);
  }
  return value;
}

function getRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Matrix ${field} must be an object.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
