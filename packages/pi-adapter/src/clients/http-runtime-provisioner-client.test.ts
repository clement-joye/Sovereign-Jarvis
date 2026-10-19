import { describe, expect, it, vi } from "vitest";
import { HttpRuntimeProvisionerClient } from "./http-runtime-provisioner-client.js";
describe("HttpRuntimeProvisionerClient", () => {
  it("uses the internal token and trusted template selection payload", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ runtimeId: "runtime-1" }), { status: 201 }));
    const client = new HttpRuntimeProvisionerClient("http://provisioner.test/", "secret", fetchFn);
    await expect(client.provisionReviewed("one", "code-project", "1.0.0")).resolves.toBe(
      "runtime-1"
    );
    expect(fetchFn).toHaveBeenCalledWith(
      "http://provisioner.test/v1/runtimes/provision",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer secret" }),
        body: JSON.stringify({
          workspaceId: "one",
          templateId: "code-project",
          templateVersion: "1.0.0"
        })
      })
    );
  });

  it("routes execution through the room-independent workspace runtime path", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          id: "run-1",
          traceId: "trace-1",
          sessionId: "session-1",
          status: "completed",
          generatedFiles: [],
          startedAt: "2026-08-04T12:00:00.000Z",
          finishedAt: "2026-08-04T12:00:01.000Z"
        }),
        { status: 200 }
      )
    );
    const client = new HttpRuntimeProvisionerClient("http://provisioner.test", "secret", fetchFn);
    await client.run("workspace-1", {
      schemaVersion: 1,
      id: "run-1",
      traceId: "trace-1",
      sessionId: "session-1",
      inputText: "hello",
      images: [],
      sourceReferences: [],
      timeoutSeconds: 60,
      priority: "interactive"
    });
    expect(fetchFn).toHaveBeenCalledWith(
      "http://provisioner.test/v1/runtimes/workspace-1/pi-runs",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer secret" })
      })
    );
  });

  it.each(["http://provisioner.test", "http://provisioner.test/"])(
    "constructs the health endpoint from base URL %s",
    async (baseUrl) => {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify({ health: "ready" }), { status: 200 }));
      const client = new HttpRuntimeProvisionerClient(baseUrl, "secret", fetchFn);

      await expect(client.health("workspace / one")).resolves.toBe("ready");
      expect(fetchFn).toHaveBeenCalledWith(
        "http://provisioner.test/v1/runtimes/workspace%20%2F%20one/health",
        expect.objectContaining({
          headers: expect.objectContaining({ authorization: "Bearer secret" })
        })
      );
    }
  );

  it("includes the provisioner error body when a request fails", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ error: "Reviewed runtime image is unavailable: sha256:deadbeef" }),
        {
          status: 500
        }
      )
    );
    const client = new HttpRuntimeProvisionerClient("http://provisioner.test", "secret", fetchFn);

    await expect(client.provisionReviewed("one", "code-project", "1.0.0")).rejects.toThrow(
      "Runtime provisioner request failed: 500: Reviewed runtime image is unavailable: sha256:deadbeef"
    );
  });
});
