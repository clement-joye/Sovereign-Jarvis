import { createHash } from "node:crypto";

import type { FileAttachmentStore } from "@second-brain/media-adapter";

import type { MatrixMediaDecryptor } from "../sessions/matrix-e2ee-client.js";
import type { MatrixMediaClient } from "./matrix-media.js";

export function prepareInboundMediaEvent(
  media: MatrixMediaClient,
  attachments: FileAttachmentStore
): (event: unknown, decryptMedia?: MatrixMediaDecryptor) => Promise<unknown> {
  return async (event, decryptMedia) => {
    if (!isRecord(event) || !isRecord(event.content)) return event;
    const msgtype = supportedMediaType(event.content.msgtype);
    const encryptedFile = toEncryptedFile(event.content.file);
    const contentUri =
      typeof event.content.url === "string" ? event.content.url : encryptedFile?.url;
    if (!msgtype || !contentUri || (encryptedFile && !decryptMedia)) return event;

    const downloaded = await downloadInboundMedia({
      media,
      content: event.content,
      contentUri,
      encryptedFile,
      decryptMedia
    });
    const eventId = typeof event.event_id === "string" ? event.event_id : "unknown";
    const suffix = msgtype === "m.image" ? "image" : msgtype === "m.audio" ? "audio" : "file";
    const encodedEventId = Buffer.from(eventId).toString("base64url");
    const storageKey = `inbound/matrix/${encodedEventId}.${suffix}`;
    const sha256 = createHash("sha256").update(downloaded.bytes).digest("hex");
    await attachments.put({
      bytes: downloaded.bytes,
      reference: {
        schemaVersion: 1,
        id: `attachment-${encodedEventId}`,
        purpose: "inbound",
        mediaType: downloaded.mediaType,
        sizeBytes: downloaded.bytes.byteLength,
        sha256,
        storageKey
      }
    });
    return storedMediaEvent({
      event,
      content: event.content,
      contentUri,
      msgtype,
      downloaded,
      storageKey,
      sha256
    });
  };
}

async function downloadInboundMedia(input: {
  media: MatrixMediaClient;
  content: Record<string, unknown>;
  contentUri: string;
  encryptedFile: Parameters<MatrixMediaDecryptor>[0] | undefined;
  decryptMedia: MatrixMediaDecryptor | undefined;
}): Promise<{ bytes: Uint8Array; mediaType: string }> {
  if (!input.encryptedFile) return input.media.download(input.contentUri);
  if (!input.decryptMedia) throw new Error("Missing Matrix media decryptor.");
  return {
    bytes: await input.decryptMedia(input.encryptedFile),
    mediaType: declaredMediaType(input.content) ?? "application/octet-stream"
  };
}

function storedMediaEvent(input: {
  event: Record<string, unknown>;
  content: Record<string, unknown>;
  contentUri: string;
  msgtype: "m.image" | "m.audio" | "m.file";
  downloaded: { bytes: Uint8Array; mediaType: string };
  storageKey: string;
  sha256: string;
}) {
  const { event, content, contentUri, msgtype, downloaded, storageKey, sha256 } = input;
  return {
    ...event,
    content: {
      ...content,
      ...(typeof content.url === "string" ? {} : { url: contentUri }),
      "org.second-brain.stored_attachment": {
        storage_key: storageKey,
        size_bytes: downloaded.bytes.byteLength,
        sha256,
        ...(msgtype === "m.file" ? documentExcerpt(downloaded.mediaType, downloaded.bytes) : {})
      }
    }
  };
}

function supportedMediaType(value: unknown): "m.image" | "m.audio" | "m.file" | undefined {
  return value === "m.image" || value === "m.audio" || value === "m.file" ? value : undefined;
}

function documentExcerpt(mediaType: string, bytes: Uint8Array) {
  if (!mediaType.startsWith("text/") && mediaType !== "application/json") return undefined;
  const text = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes)
    .replace(/\u0000/g, "")
    .trim();
  return text ? { text_excerpt: text.slice(0, 20_000) } : undefined;
}

function declaredMediaType(content: Record<string, unknown>): string | undefined {
  return isRecord(content.info) && typeof content.info.mimetype === "string"
    ? content.info.mimetype
    : undefined;
}

function toEncryptedFile(value: unknown): Parameters<MatrixMediaDecryptor>[0] | undefined {
  return isRecord(value) && typeof value.url === "string"
    ? (value as unknown as Parameters<MatrixMediaDecryptor>[0])
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
