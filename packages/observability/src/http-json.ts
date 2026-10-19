import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export const JSON_BODY_LIMIT_BYTES = 1_048_576;
export const REQUEST_ID_HEADER = "x-request-id";

export class JsonBodyTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super(`JSON request body exceeds the ${limitBytes}-byte limit.`);
    this.name = "JsonBodyTooLargeError";
  }
}

export class JsonContentTypeError extends Error {
  constructor(readonly contentType: string) {
    super(`Expected application/json request content type, received ${contentType}.`);
    this.name = "JsonContentTypeError";
  }
}

export function isJsonBodyTooLargeError(error: unknown): error is JsonBodyTooLargeError {
  return error instanceof JsonBodyTooLargeError;
}

export function isJsonContentTypeError(error: unknown): error is JsonContentTypeError {
  return error instanceof JsonContentTypeError;
}

export interface JsonRequestErrorResponse {
  statusCode: 400 | 413 | 415;
  body: { error: "invalid_json" | "payload_too_large" | "unsupported_media_type" };
}

/** Maps shared JSON boundary failures to stable HTTP responses. */
export function jsonRequestErrorResponse(error: unknown): JsonRequestErrorResponse | undefined {
  if (isJsonBodyTooLargeError(error)) {
    return { statusCode: 413, body: { error: "payload_too_large" } };
  }
  if (isJsonContentTypeError(error)) {
    return { statusCode: 415, body: { error: "unsupported_media_type" } };
  }
  if (error instanceof SyntaxError) {
    return { statusCode: 400, body: { error: "invalid_json" } };
  }
  return undefined;
}

/** Adds a safe request identifier to an HTTP response and returns it for logging. */
export function attachRequestId(request: IncomingMessage, response: ServerResponse): string {
  const requestId = validRequestId(request.headers[REQUEST_ID_HEADER]) ?? randomUUID();
  response.setHeader(REQUEST_ID_HEADER, requestId);
  return requestId;
}

function validRequestId(value: string | string[] | undefined): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && /^[A-Za-z0-9._-]{1,128}$/.test(candidate) ? candidate : undefined;
}

/**
 * Reads a JSON request body using the wire behavior shared by the local HTTP
 * services: an empty body is an empty object and malformed JSON rejects.
 */
export async function readJsonBody(
  request: IncomingMessage,
  limitBytes = JSON_BODY_LIMIT_BYTES
): Promise<unknown> {
  assertJsonContentType(request.headers["content-type"]);
  const contentLength = Number(request.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > limitBytes) {
    request.resume();
    throw new JsonBodyTooLargeError(limitBytes);
  }

  const chunks: Uint8Array[] = [];
  let sizeBytes = 0;
  for await (const chunk of request as AsyncIterable<unknown>) {
    const bytes = requestBodyChunk(chunk);
    sizeBytes += bytes.byteLength;
    if (sizeBytes > limitBytes) {
      request.resume();
      throw new JsonBodyTooLargeError(limitBytes);
    }
    chunks.push(bytes);
  }
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function assertJsonContentType(contentType: string | undefined): void {
  if (!contentType || contentType.toLowerCase().startsWith("application/json")) return;
  throw new JsonContentTypeError(contentType);
}

function requestBodyChunk(chunk: unknown): Uint8Array {
  if (typeof chunk === "string") return Buffer.from(chunk);
  if (chunk instanceof Uint8Array) return chunk;
  throw new Error("Unsupported request body chunk.");
}

/** Writes a newline-terminated JSON response with the canonical content type. */
export function writeJsonBody(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(`${JSON.stringify(body)}\n`);
}
