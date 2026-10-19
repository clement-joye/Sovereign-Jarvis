import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  attachRequestId,
  isJsonBodyTooLargeError,
  isJsonContentTypeError,
  jsonRequestErrorResponse,
  JSON_BODY_LIMIT_BYTES,
  REQUEST_ID_HEADER,
  readJsonBody
} from "./http-json.js";

describe("readJsonBody", () => {
  it("reuses a valid request ID and replaces an unsafe one", () => {
    const response = { setHeader: vi.fn() };
    const validRequest = { headers: { [REQUEST_ID_HEADER]: "request-1" } };
    const invalidRequest = { headers: { [REQUEST_ID_HEADER]: "contains spaces" } };

    expect(attachRequestId(validRequest as never, response as never)).toBe("request-1");
    expect(attachRequestId(invalidRequest as never, response as never)).toMatch(/^[a-f0-9-]{36}$/);
    expect(response.setHeader).toHaveBeenNthCalledWith(1, REQUEST_ID_HEADER, "request-1");
  });

  it("maps shared JSON request errors to stable responses", () => {
    expect(jsonRequestErrorResponse(new SyntaxError("invalid"))).toEqual({
      statusCode: 400,
      body: { error: "invalid_json" }
    });
  });

  it("rejects an explicit non-JSON content type", async () => {
    const request = Object.assign(new PassThrough(), {
      headers: { "content-type": "text/plain" }
    });
    request.end("not json");

    await expect(readJsonBody(request as never)).rejects.toSatisfy(isJsonContentTypeError);
  });

  it("rejects a streamed body over the shared limit", async () => {
    const request = Object.assign(new PassThrough(), { headers: {} });
    request.end(Buffer.alloc(JSON_BODY_LIMIT_BYTES + 1));

    await expect(readJsonBody(request as never)).rejects.toSatisfy(isJsonBodyTooLargeError);
  });
});
