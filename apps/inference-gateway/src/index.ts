import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

const DEFAULT_PORT = 3050;
const DEFAULT_MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";

export interface InferenceGatewayOptions {
  upstreamBaseUrl: string;
  apiKey?: string;
  maxRequestBytes?: number;
  fetch?: typeof fetch;
}

export function createInferenceGateway(options: InferenceGatewayOptions): Server {
  const upstreamBaseUrl = normalizeUpstreamBaseUrl(options.upstreamBaseUrl);
  const fetchImplementation = options.fetch ?? fetch;
  const maxRequestBytes = options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;

  return createServer((request, response) => {
    void route(request, response, {
      upstreamBaseUrl,
      apiKey: options.apiKey ?? "",
      maxRequestBytes,
      fetch: fetchImplementation
    }).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      if (error instanceof RequestTooLargeError) {
        writeJson(response, 413, { error: "request_too_large" });
        return;
      }
      writeJson(response, 502, { error: "inference_upstream_unavailable" });
    });
  });
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  options: Required<InferenceGatewayOptions>
): Promise<void> {
  if (request.method === "GET" && request.url === "/health") {
    writeJson(response, 200, { service: "inference-gateway", status: "live" });
    return;
  }

  if (request.method !== "POST" || request.url !== CHAT_COMPLETIONS_PATH) {
    writeJson(response, 404, { error: "not_found" });
    return;
  }

  const body = await readLimitedBody(request, options.maxRequestBytes);
  const controller = new AbortController();
  request.once("aborted", () => controller.abort());

  const headers: Record<string, string> = {
    "content-type": request.headers["content-type"] ?? "application/json",
    accept: request.headers.accept ?? "application/json"
  };
  if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;

  const upstream = await options.fetch(`${options.upstreamBaseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body,
    signal: controller.signal
  });

  response.statusCode = upstream.status;
  for (const name of ["content-type", "cache-control", "x-request-id"] as const) {
    const value = upstream.headers.get(name);
    if (value) response.setHeader(name, value);
  }
  if (!upstream.body) {
    response.end();
    return;
  }
  await pipeline(Readable.fromWeb(upstream.body), response);
}

async function readLimitedBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > limit) throw new RequestTooLargeError();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

class RequestTooLargeError extends Error {}

function normalizeUpstreamBaseUrl(value: string): string {
  const url = new URL(value);
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error("INFERENCE_UPSTREAM_BASE_URL must use HTTP or HTTPS.");
  }
  return url.href.replace(/\/$/u, "");
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function optionalEnvironment(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function loadPort(): number {
  const value = Number(process.env.INFERENCE_GATEWAY_PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error("INFERENCE_GATEWAY_PORT must be a valid TCP port.");
  }
  return value;
}

function isEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isEntrypoint()) {
  const port = loadPort();
  const server = createInferenceGateway({
    upstreamBaseUrl:
      process.env.INFERENCE_UPSTREAM_BASE_URL ?? "http://host.docker.internal:8080/v1",
    apiKey: optionalEnvironment("INFERENCE_SERVER_API_KEY")
  });
  server.listen(port, "0.0.0.0", () => {
    console.info(JSON.stringify({ service: "inference-gateway", event: "started", port }));
  });
}
