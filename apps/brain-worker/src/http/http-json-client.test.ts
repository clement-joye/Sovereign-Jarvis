import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpRequestTimeoutError, requestJson } from "./http-json-client.js";

describe("requestJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("turns an expired abort signal into a path-aware timeout error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            const reason = init?.signal?.reason;
            init?.signal?.addEventListener("abort", () =>
              reject(reason instanceof Error ? reason : new Error("aborted"))
            );
          })
      )
    );

    await expect(
      requestJson({
        baseUrl: "http://control.test",
        path: "/v1/jobs/claim",
        method: "POST",
        body: {},
        timeoutMs: 1,
        parse: (body) => body
      })
    ).rejects.toMatchObject({
      name: HttpRequestTimeoutError.name,
      method: "POST",
      path: "/v1/jobs/claim",
      timeoutMs: 1
    });
  });
});
