import { afterEach, describe, expect, it, vi } from "vitest";

import { exampleScheduledJob } from "@second-brain/contracts";

import { HttpScheduleRepository } from "./control-plane-schedule-client.js";

describe("HttpScheduleRepository", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates schedule lists returned by the control plane", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([exampleScheduledJob]))
    );

    await expect(new HttpScheduleRepository("http://control.test").list()).resolves.toEqual([
      exampleScheduledJob
    ]);
  });

  it("preserves missing schedules and rejects malformed successful responses", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ id: "schedule-1" }));
    vi.stubGlobal("fetch", fetchMock);
    const repository = new HttpScheduleRepository("http://control.test");

    await expect(repository.get("missing")).resolves.toBeUndefined();
    await expect(repository.get("schedule-1")).rejects.toThrow();
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}
