import { afterEach, describe, expect, it, vi } from "vitest";

import { examplePiRunRequest } from "@second-brain/contracts";

import { HttpPiRunner } from "./pi-runner-client.js";

describe("HttpPiRunner", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates Pi run results from the runner", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(runResult())));

    await expect(new HttpPiRunner("http://pi.test").run(examplePiRunRequest)).resolves.toEqual(
      runResult()
    );
  });

  it("rejects malformed cancellation acknowledgements", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ cancelled: true }))
    );

    await expect(new HttpPiRunner("http://pi.test").cancel("run-1")).rejects.toThrow();
  });

  it("preserves path-aware errors from failed runner requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response("unavailable", { status: 503 }))
    );

    await expect(new HttpPiRunner("http://pi.test").cancel("run-1")).rejects.toMatchObject({
      method: "POST",
      path: "/v1/pi-runs/run-1/cancel",
      statusCode: 503,
      responseBody: "unavailable"
    });
  });

  it("passes the configured execution timeout to Pi Runner requests", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(runResult()));
    vi.stubGlobal("fetch", fetchMock);

    await new HttpPiRunner("http://pi.test", 1000).run(examplePiRunRequest);

    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function runResult() {
  return {
    schemaVersion: 1,
    id: "pi-run-1",
    traceId: "trace-1",
    sessionId: "session-1",
    status: "completed" as const,
    text: "Done.",
    generatedFiles: [],
    startedAt: "2026-07-27T00:00:00.000Z",
    finishedAt: "2026-07-27T00:00:01.000Z"
  };
}
