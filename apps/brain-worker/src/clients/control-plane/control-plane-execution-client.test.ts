import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpExecutionRepository } from "./control-plane-execution-client.js";

describe("HttpExecutionRepository", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates execution history returned by the control plane", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([execution()])));

    await expect(
      new HttpExecutionRepository("http://control.test").listBySchedule("schedule-1")
    ).resolves.toEqual([execution()]);
  });

  it("returns undefined for missing executions and rejects malformed successful responses", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ id: "execution-1" }));
    vi.stubGlobal("fetch", fetchMock);
    const repository = new HttpExecutionRepository("http://control.test");

    await expect(repository.get("missing")).resolves.toBeUndefined();
    await expect(repository.get("execution-1")).rejects.toThrow();
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function execution() {
  return {
    schemaVersion: 1,
    id: "execution-1",
    scheduleId: "schedule-1",
    scheduledFor: "2026-07-27T09:00:00.000Z",
    status: "queued" as const,
    attempt: 0,
    createdAt: "2026-07-27T09:00:00.000Z"
  };
}
