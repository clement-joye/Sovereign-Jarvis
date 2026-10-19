import { afterEach, describe, expect, it, vi } from "vitest";

import { exampleJob } from "@second-brain/contracts";

import { HttpJobQueue } from "./control-plane-job-client.js";

describe("HttpJobQueue", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates claimed jobs from the control plane", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([exampleJob]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new HttpJobQueue("http://control.test").claim({
        workerId: "worker-1",
        limit: 1,
        leaseMs: 30_000,
        jobTypes: ["run_agent"],
        now: new Date()
      })
    ).resolves.toEqual([exampleJob]);
    const requestBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(typeof requestBody).toBe("string");
    expect(JSON.parse(requestBody as string)).toMatchObject({
      workerId: "worker-1",
      jobTypes: ["run_agent"]
    });
  });

  it("rejects malformed completion responses", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: false })));

    await expect(
      new HttpJobQueue("http://control.test").complete({ jobId: "job-1", leaseOwner: "worker-1" })
    ).rejects.toThrow();
  });

  it("renews a claimed job through the control plane", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      new HttpJobQueue("http://control.test").renew({
        jobId: "job-1",
        leaseOwner: "worker-1",
        now: new Date(),
        leaseMs: 90_000
      })
    ).resolves.toBe(true);
    const requested = fetchMock.mock.calls[0]?.[0];
    const requestedUrl =
      typeof requested === "string"
        ? requested
        : requested instanceof URL
          ? requested.href
          : requested?.url;
    expect(requestedUrl).toContain("/v1/jobs/job-1/heartbeat");
  });

  it("passes a configured timeout signal to control-plane requests", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([exampleJob]));
    vi.stubGlobal("fetch", fetchMock);

    await new HttpJobQueue("http://control.test", 1000).claim({
      workerId: "worker-1",
      limit: 1,
      leaseMs: 30_000,
      now: new Date()
    });

    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}
