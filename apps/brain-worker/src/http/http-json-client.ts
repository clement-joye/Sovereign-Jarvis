import { HttpResponseError } from "./http-response-error.js";

export class HttpRequestTimeoutError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly timeoutMs: number
  ) {
    super(`${method} ${path} timed out after ${timeoutMs}ms.`);
    this.name = "HttpRequestTimeoutError";
  }
}

/** Performs a JSON request while preserving path-aware HTTP error reporting. */
export async function requestJson<T>(input: {
  baseUrl: string;
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  parse: (body: unknown) => T;
}): Promise<T> {
  const response = await fetchJsonResponse(input);
  if (!response.ok) {
    throw new HttpResponseError(input.method, input.path, response.status, await response.text());
  }
  return input.parse(await response.json());
}

/** Performs a JSON request whose documented missing-resource response is undefined. */
export async function requestOptionalJson<T>(input: {
  baseUrl: string;
  path: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  parse: (body: unknown) => T;
}): Promise<T | undefined> {
  const response = await fetchJsonResponse({ ...input, method: "GET" });
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new HttpResponseError("GET", input.path, response.status, await response.text());
  }
  return input.parse(await response.json());
}

async function fetchJsonResponse(input: {
  baseUrl: string;
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}): Promise<Response> {
  const signal = input.timeoutMs === undefined ? undefined : AbortSignal.timeout(input.timeoutMs);
  const request = {
    method: input.method,
    ...(signal ? { signal } : {}),
    ...(input.body === undefined
      ? input.headers
        ? { headers: input.headers }
        : {}
      : {
          headers: { ...input.headers, "content-type": "application/json" },
          body: JSON.stringify(input.body)
        })
  };
  try {
    return await fetch(new URL(input.path, input.baseUrl), request);
  } catch (error) {
    if (signal?.aborted && input.timeoutMs !== undefined) {
      throw new HttpRequestTimeoutError(input.method, input.path, input.timeoutMs);
    }
    throw error;
  }
}
