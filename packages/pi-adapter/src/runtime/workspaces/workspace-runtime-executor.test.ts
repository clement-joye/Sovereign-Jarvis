import { describe, expect, it, vi } from "vitest";

import { examplePiRunRequest } from "@second-brain/contracts";

import { HttpWorkspaceRuntimeExecutor } from "./workspace-runtime-executor.js";

const catalogDigest = `sha256:${"a".repeat(64)}`;
const policyDigest = `sha256:${"b".repeat(64)}`;
const resourceDigest = `sha256:${"c".repeat(64)}`;
const runtimeName = "jarvis-runtime-brain-484d4f88b59b95fc9409ad70";

describe("HttpWorkspaceRuntimeExecutor", () => {
  it("uses only the controlled runtime DNS name and validates Pi results", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(result()), { status: 200 }));
    const executor = new HttpWorkspaceRuntimeExecutor(catalogDigest, fetchFn);

    await expect(
      executor.run("jarvis-runtime-brain-484d4f88b59b95fc9409ad70", examplePiRunRequest)
    ).resolves.toEqual(result());
    expect(fetchFn).toHaveBeenCalledWith(
      "http://jarvis-runtime-brain-484d4f88b59b95fc9409ad70:3010/v1/pi-runs",
      expect.objectContaining({ body: JSON.stringify(examplePiRunRequest) })
    );
  });

  it("rejects names outside the provisioner's controlled namespace", async () => {
    const executor = new HttpWorkspaceRuntimeExecutor(catalogDigest, vi.fn());
    await expect(executor.run("brain-control", examplePiRunRequest)).rejects.toThrow(
      "Invalid workspace runtime name"
    );
  });

  it("forwards browser actions only to a controlled runtime DNS name", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ acted: true }), { status: 200 }));
    const executor = new HttpWorkspaceRuntimeExecutor(catalogDigest, fetchFn);
    const runtimeName = "jarvis-runtime-browser-484d4f88b59b95fc9409ad70";

    await expect(
      executor.runtimeAction(runtimeName, "browser-type", { selector: "#query", text: "Jarvis" })
    ).resolves.toEqual({ acted: true });
    expect(fetchFn).toHaveBeenCalledWith(
      `http://${runtimeName}:3010/v1/runtime-actions`,
      expect.objectContaining({
        body: JSON.stringify({
          operationId: "browser-type",
          parameters: { selector: "#query", text: "Jarvis" }
        })
      })
    );
    await expect(
      executor.runtimeAction("brain-control", "browser-click", { selector: "button" })
    ).rejects.toThrow("Invalid workspace runtime name");
  });

  it("probes only the controlled runtime health endpoint and treats transport errors as unhealthy", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          service: "pi-runner",
          status: "live",
          checkedAt: "2026-08-28T20:00:00.000Z",
          version: "0.0.0",
          catalogDigest,
          dependencies: []
        }),
        { status: 200 }
      )
    );
    const executor = new HttpWorkspaceRuntimeExecutor(catalogDigest, fetchFn);

    await expect(executor.health("jarvis-runtime-brain-484d4f88b59b95fc9409ad70")).resolves.toBe(
      true
    );
    expect(fetchFn).toHaveBeenCalledWith(
      "http://jarvis-runtime-brain-484d4f88b59b95fc9409ad70:3010/health",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );

    fetchFn.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(executor.health("jarvis-runtime-brain-484d4f88b59b95fc9409ad70")).resolves.toBe(
      false
    );
  });

  it("treats a live runtime from another catalog release as unhealthy", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          service: "pi-runner",
          status: "live",
          checkedAt: "2026-08-28T20:00:00.000Z",
          version: "0.0.0",
          catalogDigest: `sha256:${"b".repeat(64)}`,
          dependencies: []
        }),
        { status: 200 }
      )
    );

    await expect(
      new HttpWorkspaceRuntimeExecutor(catalogDigest, fetchFn).health(
        "jarvis-runtime-brain-484d4f88b59b95fc9409ad70"
      )
    ).resolves.toBe(false);
  });

  it("accepts a runtime when the split health identity matches", async () => {
    const fetchFn = healthFetch({ catalogDigest, policyDigest, resourceDigest });
    const executor = new HttpWorkspaceRuntimeExecutor(
      catalogDigest,
      fetchFn,
      policyDigest,
      resourceDigest
    );

    await expect(executor.health(runtimeName)).resolves.toBe(true);
  });

  it("rejects a runtime with a stale policy projection", async () => {
    const fetchFn = healthFetch({
      catalogDigest,
      policyDigest: `sha256:${"d".repeat(64)}`,
      resourceDigest
    });
    const executor = new HttpWorkspaceRuntimeExecutor(
      catalogDigest,
      fetchFn,
      policyDigest,
      resourceDigest
    );

    await expect(executor.health(runtimeName)).resolves.toBe(false);
  });

  it("rejects a runtime with a stale resource projection", async () => {
    const fetchFn = healthFetch({
      catalogDigest,
      policyDigest,
      resourceDigest: `sha256:${"d".repeat(64)}`
    });
    const executor = new HttpWorkspaceRuntimeExecutor(
      catalogDigest,
      fetchFn,
      policyDigest,
      resourceDigest
    );

    await expect(executor.health(runtimeName)).resolves.toBe(false);
  });

  it("treats the full catalog digest as diagnostic when split projections match", async () => {
    const fetchFn = healthFetch({
      catalogDigest: `sha256:${"d".repeat(64)}`,
      policyDigest,
      resourceDigest
    });
    const executor = new HttpWorkspaceRuntimeExecutor(
      catalogDigest,
      fetchFn,
      policyDigest,
      resourceDigest
    );

    await expect(executor.health(runtimeName)).resolves.toBe(true);
  });

  it("rejects an old runtime image even when its catalog provenance is otherwise harmless", async () => {
    const runtimeImageId = `sha256:${"e".repeat(64)}`;
    const fetchFn = healthFetch({
      catalogDigest: `sha256:${"d".repeat(64)}`,
      policyDigest,
      resourceDigest,
      runtimeImageId: `sha256:${"f".repeat(64)}`
    });
    const executor = new HttpWorkspaceRuntimeExecutor(catalogDigest, fetchFn, {
      policyDigest,
      resourceDigest,
      runtimeImageIds: { brain: runtimeImageId }
    });

    await expect(executor.health(runtimeName)).resolves.toBe(false);
  });
});

function healthFetch(input: {
  catalogDigest: string;
  policyDigest: string;
  resourceDigest: string;
  runtimeImageId?: string;
}) {
  return vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        schemaVersion: 1,
        service: "pi-runner",
        status: "live",
        checkedAt: "2026-08-28T20:00:00.000Z",
        version: "0.0.0",
        apiVersion: "1",
        ...input,
        dependencies: []
      }),
      { status: 200 }
    )
  );
}

function result() {
  return {
    schemaVersion: 1,
    id: "pi-run-1",
    traceId: "trace-1",
    sessionId: "session-1",
    status: "completed",
    generatedFiles: [],
    startedAt: "2026-08-04T12:00:00.000Z",
    finishedAt: "2026-08-04T12:00:01.000Z"
  };
}
