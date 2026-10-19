import { once } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { JSON_BODY_LIMIT_BYTES } from "@second-brain/observability";

import { createPiRunnerServer, type PiRunnerHttpService } from "./server.js";

const catalogDigest = `sha256:${"a".repeat(64)}`;

describe("Pi Runner HTTP server", () => {
  it("returns the versioned health envelope", async () => {
    const { service } = createService();

    await withServer(service, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health`);

      expect(response.status).toBe(200);
      expect(response.headers.get("x-request-id")).toBeTruthy();
      await expect(response.json()).resolves.toMatchObject({
        schemaVersion: 1,
        service: "pi-runner",
        status: "live",
        version: "test",
        apiVersion: "1",
        catalogDigest
      });
    });
  });

  it("returns a valid caller-provided request ID", async () => {
    const { service } = createService();

    await withServer(service, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health`, {
        headers: { "x-request-id": "test-request-1" }
      });

      expect(response.headers.get("x-request-id")).toBe("test-request-1");
    });
  });

  it("advertises the split catalog projections when configured", async () => {
    const { service } = createService();
    const policyDigest = `sha256:${"b".repeat(64)}`;
    const resourceDigest = `sha256:${"c".repeat(64)}`;

    await withServer(
      service,
      async (baseUrl) => {
        await expect((await fetch(`${baseUrl}/health`)).json()).resolves.toMatchObject({
          apiVersion: "1",
          policyDigest,
          resourceDigest
        });
      },
      { policyDigest, resourceDigest }
    );
  });

  it("rejects malformed session creation without invoking the service", async () => {
    const { service, createSession } = createService();

    await withServer(service, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/pi-sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "", unexpected: true })
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: "invalid_pi_session_request"
      });
      expect(createSession).not.toHaveBeenCalled();
    });
  });

  it("creates a validated session through the service boundary", async () => {
    const { service, createSession } = createService();

    await withServer(service, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/pi-sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-123" })
      });

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({ sessionId: "session-123" });
      expect(createSession).toHaveBeenCalledWith("session-123");
    });
  });

  it("rejects an oversized JSON request before invoking the service", async () => {
    const { service, createSession } = createService();

    await withServer(service, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/pi-sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "s".repeat(JSON_BODY_LIMIT_BYTES) })
      });

      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toEqual({ error: "payload_too_large" });
      expect(createSession).not.toHaveBeenCalled();
    });
  });

  it("rejects an explicit non-JSON request before invoking the service", async () => {
    const { service, createSession } = createService();

    await withServer(service, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/pi-sessions`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "not json"
      });

      expect(response.status).toBe(415);
      await expect(response.json()).resolves.toEqual({ error: "unsupported_media_type" });
      expect(createSession).not.toHaveBeenCalled();
    });
  });

  it("returns a stable error for malformed JSON before invoking the service", async () => {
    const { service, createSession } = createService();

    await withServer(service, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/pi-sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{"
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "invalid_json" });
      expect(createSession).not.toHaveBeenCalled();
    });
  });

  it("cancels a run through the extracted Pi route handler", async () => {
    const { service, cancel } = createService();

    await withServer(service, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/pi-runs/run-123/cancel`, { method: "POST" });

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toEqual({ cancelled: true, runId: "run-123" });
      expect(cancel).toHaveBeenCalledWith("run-123");
    });
  });

  it("rejects an invalid Pi run request before invoking the service", async () => {
    const { service, run } = createService();

    await withServer(service, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/pi-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "" })
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: "invalid_pi_run_request"
      });
      expect(run).not.toHaveBeenCalled();
    });
  });

  it("forwards a validated Pi run to the service", async () => {
    const { service, run } = createService();
    run.mockResolvedValue({ status: "completed", text: "ok" });

    await withServer(service, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/pi-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          id: "pi-run-1",
          catalogDigest,
          traceId: "trace-1",
          sessionId: "session-1",
          inputText: "hello",
          images: [],
          sourceReferences: [],
          timeoutSeconds: 60,
          priority: "interactive"
        })
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ status: "completed", text: "ok" });
      expect(run).toHaveBeenCalledTimes(1);
    });
  });

  it("uses execution identities instead of rejecting a harmless catalog-only difference", async () => {
    const { service, run } = createService();
    run.mockResolvedValue({ status: "completed", text: "ok" });
    const policyDigest = `sha256:${"b".repeat(64)}`;
    const resourceDigest = `sha256:${"c".repeat(64)}`;
    const runtimeImageId = `sha256:${"d".repeat(64)}`;
    const provenanceDigest = `sha256:${"e".repeat(64)}`;

    await withServer(
      service,
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/pi-runs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            schemaVersion: 1,
            id: "pi-run-identity",
            catalogDigest: provenanceDigest,
            workspaceId: "workspace-1",
            agentId: "brain",
            traceId: "trace-identity",
            sessionId: "session-identity",
            inputText: "hello",
            images: [],
            sourceReferences: [],
            timeoutSeconds: 60,
            priority: "interactive",
            effectiveRunPolicy: effectiveRunPolicy({
              catalogDigest: provenanceDigest,
              platformPolicyDigest: policyDigest,
              resourceDigest,
              runtimeImageId
            })
          })
        });
        expect(response.status).toBe(200);
        expect(run).toHaveBeenCalledOnce();
      },
      { policyDigest, resourceDigest, runtimeImageId }
    );
  });

  it("fails closed when an identity-aware Pi Runner receives missing or stale execution identity", async () => {
    const { service, run } = createService();
    const policyDigest = `sha256:${"b".repeat(64)}`;
    const resourceDigest = `sha256:${"c".repeat(64)}`;
    const runtimeImageId = `sha256:${"d".repeat(64)}`;
    await withServer(
      service,
      async (baseUrl) => {
        const missing = await fetch(`${baseUrl}/v1/pi-runs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            schemaVersion: 1,
            id: "pi-run-missing",
            traceId: "trace-missing",
            sessionId: "session-missing",
            inputText: "hello",
            images: [],
            sourceReferences: [],
            timeoutSeconds: 60,
            priority: "interactive"
          })
        });
        expect(missing.status).toBe(409);
        const stale = await fetch(`${baseUrl}/v1/pi-runs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            schemaVersion: 1,
            id: "pi-run-stale-policy",
            catalogDigest,
            workspaceId: "workspace-1",
            agentId: "brain",
            traceId: "trace-stale-policy",
            sessionId: "session-stale-policy",
            inputText: "hello",
            images: [],
            sourceReferences: [],
            timeoutSeconds: 60,
            priority: "interactive",
            effectiveRunPolicy: effectiveRunPolicy({
              catalogDigest,
              platformPolicyDigest: `sha256:${"f".repeat(64)}`,
              resourceDigest,
              runtimeImageId
            })
          })
        });
        expect(stale.status).toBe(409);
        expect(run).not.toHaveBeenCalled();
      },
      { policyDigest, resourceDigest, runtimeImageId }
    );
  });

  it("rejects a stale catalog before invoking the service", async () => {
    const { service, run } = createService();

    await withServer(service, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/pi-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          id: "pi-run-stale",
          catalogDigest: `sha256:${"b".repeat(64)}`,
          traceId: "trace-stale",
          sessionId: "session-stale",
          inputText: "hello",
          images: [],
          sourceReferences: [],
          timeoutSeconds: 60,
          priority: "interactive"
        })
      });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: "catalog_digest_mismatch",
        expectedCatalogDigest: catalogDigest
      });
      expect(run).not.toHaveBeenCalled();
    });
  });

  it("cancels a Pi session through the extracted route handler", async () => {
    const { service, cancelSession } = createService();

    await withServer(service, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/pi-sessions/session-7/cancel`, {
        method: "POST"
      });

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toEqual({
        cancelled: true,
        sessionId: "session-7"
      });
      expect(cancelSession).toHaveBeenCalledWith("session-7");
    });
  });

  it("closes a Pi session and forwards the response body", async () => {
    const { service, closeSession } = createService();
    closeSession.mockResolvedValue({ sessionId: "session-9", closed: true });

    await withServer(service, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/pi-sessions/session-9/close`, {
        method: "POST"
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        sessionId: "session-9",
        closed: true
      });
      expect(closeSession).toHaveBeenCalledWith("session-9");
    });
  });

  it("returns the session health snapshot for GET requests", async () => {
    const { service, sessionHealth } = createService();
    sessionHealth.mockResolvedValue({ sessionId: "session-3", alive: true });

    await withServer(service, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/pi-sessions/session-3/health`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        sessionId: "session-3",
        alive: true
      });
      expect(sessionHealth).toHaveBeenCalledWith("session-3");
    });
  });

  it("returns 404 for unknown routes without invoking the service", async () => {
    const { service, run } = createService();

    await withServer(service, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/unknown`);
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "not_found" });
      expect(run).not.toHaveBeenCalled();
    });
  });

  it("executes an internal browser action with a fixed operation contract", async () => {
    const { service, runtimeAction } = createService();

    await withServer(service, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/runtime-actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operationId: "browser-click", parameters: { selector: "#save" } })
      });

      expect(response.status).toBe(200);
      expect(runtimeAction).toHaveBeenCalledWith("browser-click", { selector: "#save" });
    });
  });
});

function createService(): {
  service: PiRunnerHttpService;
  createSession: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  cancelSession: ReturnType<typeof vi.fn>;
  closeSession: ReturnType<typeof vi.fn>;
  sessionHealth: ReturnType<typeof vi.fn>;
  runtimeAction: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn>;
} {
  const createSession = vi.fn(async (sessionId: string) => ({ sessionId }));
  const cancel = vi.fn(async () => undefined);
  const cancelSession = vi.fn(async () => undefined);
  const closeSession = vi.fn(async (sessionId: string) => ({ sessionId }));
  const sessionHealth = vi.fn(async (sessionId: string) => ({ sessionId }));
  const run = vi.fn(async () => ({}));
  const runtimeAction = vi.fn(async () => ({ acted: true }));

  return {
    service: {
      run,
      cancel,
      cancelSession,
      createSession,
      closeSession,
      sessionHealth,
      runtimeAction
    },
    createSession,
    cancel,
    cancelSession,
    closeSession,
    sessionHealth,
    runtimeAction,
    run
  };
}

async function withServer(
  service: PiRunnerHttpService,
  test: (baseUrl: string) => Promise<void>,
  identity: { policyDigest?: string; resourceDigest?: string; runtimeImageId?: string } = {}
): Promise<void> {
  const server = createPiRunnerServer({
    service,
    serviceName: "pi-runner",
    version: "test",
    catalogDigest,
    ...identity
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected Pi Runner server to listen on a TCP address.");
  }

  try {
    await test(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function effectiveRunPolicy(input: {
  catalogDigest: string;
  platformPolicyDigest: string;
  resourceDigest: string;
  runtimeImageId: string;
}) {
  return {
    schemaVersion: 2,
    ...input,
    policyDigest: `sha256:${"a".repeat(64)}`,
    workspaceId: "workspace-1",
    agentId: "brain",
    pluginIds: ["core"],
    capabilityIds: [],
    toolIds: [],
    skillPaths: [],
    extensionPaths: []
  };
}
