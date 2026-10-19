import { describe, expect, it, vi } from "vitest";
import { createRuntimeProvisionerServer } from "./index.js";

const catalogDigest = `sha256:${"a".repeat(64)}`;

describe("runtime provisioner server", () => {
  it("returns authenticated runtime health", async () => {
    const provisioner = { health: vi.fn().mockResolvedValue("ready") } as never;
    const server = createRuntimeProvisionerServer({ provisioner, token: "secret", catalogDigest });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/runtimes/one/health`, {
        headers: { authorization: "Bearer secret" }
      });
      await expect(response.json()).resolves.toEqual({ health: "ready" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("creates an isolated service HTTP surface", () => {
    const server = createRuntimeProvisionerServer();
    expect(server).toBeDefined();
    server.close();
  });

  it("requires the internal token before provisioning", async () => {
    const provisionReviewed = vi.fn().mockResolvedValue("runtime-1");
    const server = createRuntimeProvisionerServer({
      provisioner: { provisionReviewed } as never,
      token: "secret",
      catalogDigest
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");
    const url = `http://127.0.0.1:${address.port}/v1/runtimes/provision`;
    const body = JSON.stringify({
      workspaceId: "one",
      templateId: "code-project",
      templateVersion: "1.0.0"
    });
    await expect(
      fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body }).then(
        (response) => response.status
      )
    ).resolves.toBe(401);
    expect(provisionReviewed).not.toHaveBeenCalled();
    await expect(
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer secret" },
        body
      }).then((response) => response.status)
    ).resolves.toBe(201);
    expect(provisionReviewed).toHaveBeenCalledWith("one", "code-project", "1.0.0");
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  it("requires auth and passes a validated broker request only to the registry", async () => {
    const brokerExecute = vi.fn().mockResolvedValue({
      summary: "clean",
      ahead: 0,
      behind: 0,
      conflicted: false
    });
    const server = createRuntimeProvisionerServer({
      provisioner: {} as never,
      token: "secret",
      catalogDigest,
      brokerOperations: { execute: brokerExecute } as never
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");
    try {
      const body = JSON.stringify({
        implementationId: "sample-repository-control",
        workspaceId: "workspace-one",
        operationId: "sample-status",
        parameters: { repository: "owner/repo" }
      });
      await expect(
        fetch(`http://127.0.0.1:${address.port}/v1/broker/execute`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body
        }).then((response) => response.status)
      ).resolves.toBe(401);
      expect(brokerExecute).not.toHaveBeenCalled();
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/broker/execute`, {
        method: "POST",
        headers: { authorization: "Bearer secret", "content-type": "application/json" },
        body
      });
      await expect(response.json()).resolves.toEqual({
        summary: "clean",
        ahead: 0,
        behind: 0,
        conflicted: false
      });
      expect(brokerExecute).toHaveBeenCalledWith("sample-repository-control", {
        workspaceId: "workspace-one",
        operationId: "sample-status",
        parameters: { repository: "owner/repo" }
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("reports unavailable and invalid generic broker requests", async () => {
    const server = createRuntimeProvisionerServer({
      provisioner: {} as never,
      token: "secret",
      catalogDigest
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");
    try {
      const url = `http://127.0.0.1:${address.port}/v1/broker/execute`;
      await expect(
        fetch(url, {
          method: "POST",
          headers: { authorization: "Bearer secret", "content-type": "application/json" },
          body: "{}"
        }).then((response) => response.status)
      ).resolves.toBe(503);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    const validatedServer = createRuntimeProvisionerServer({
      provisioner: {} as never,
      token: "secret",
      catalogDigest,
      brokerOperations: { execute: vi.fn() } as never
    });
    await new Promise<void>((resolve) => validatedServer.listen(0, "127.0.0.1", resolve));
    const validatedAddress = validatedServer.address();
    if (!validatedAddress || typeof validatedAddress === "string")
      throw new Error("Expected TCP address");
    try {
      await expect(
        fetch(`http://127.0.0.1:${validatedAddress.port}/v1/broker/execute`, {
          method: "POST",
          headers: { authorization: "Bearer secret", "content-type": "application/json" },
          body: "{}"
        }).then((response) => response.status)
      ).resolves.toBe(400);
    } finally {
      await new Promise<void>((resolve) => validatedServer.close(() => resolve()));
    }
  });

  it("proxies a run only to the runtime named in its authenticated path", async () => {
    const run = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      id: "run-1",
      traceId: "trace-1",
      sessionId: "session-1",
      status: "completed",
      generatedFiles: [],
      startedAt: "2026-08-04T12:00:00.000Z",
      finishedAt: "2026-08-04T12:00:01.000Z"
    });
    const server = createRuntimeProvisionerServer({
      provisioner: { run } as never,
      token: "secret",
      catalogDigest
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/runtimes/one/pi-runs`, {
        method: "POST",
        headers: { authorization: "Bearer secret", "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          id: "run-1",
          catalogDigest,
          workspaceId: "other",
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
      expect(run).toHaveBeenCalledWith(
        "one",
        expect.not.objectContaining({ workspaceId: expect.anything() })
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("rejects a stale catalog before calling the workspace runtime", async () => {
    const run = vi.fn();
    const server = createRuntimeProvisionerServer({
      provisioner: { run } as never,
      token: "secret",
      catalogDigest
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/runtimes/one/pi-runs`, {
        method: "POST",
        headers: { authorization: "Bearer secret", "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          id: "run-1",
          catalogDigest: `sha256:${"b".repeat(64)}`,
          traceId: "trace-1",
          sessionId: "session-1",
          inputText: "hello",
          images: [],
          sourceReferences: [],
          timeoutSeconds: 60,
          priority: "interactive"
        })
      });
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: "catalog_digest_mismatch",
        expectedCatalogDigest: catalogDigest
      });
      expect(run).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("fails closed for a missing effective identity while allowing catalog-only provenance drift", async () => {
    const run = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      id: "run-identity",
      traceId: "trace-identity",
      sessionId: "session-identity",
      status: "completed",
      generatedFiles: [],
      startedAt: "2026-08-04T12:00:00.000Z",
      finishedAt: "2026-08-04T12:00:01.000Z"
    });
    const policyDigest = `sha256:${"b".repeat(64)}`;
    const resourceDigest = `sha256:${"c".repeat(64)}`;
    const server = createRuntimeProvisionerServer({
      provisioner: { run } as never,
      token: "secret",
      catalogDigest,
      executionIdentity: { platformPolicyDigest: policyDigest, resourceDigest }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");
    const url = `http://127.0.0.1:${address.port}/v1/runtimes/one/pi-runs`;
    try {
      const missing = await fetch(url, {
        method: "POST",
        headers: { authorization: "Bearer secret", "content-type": "application/json" },
        body: JSON.stringify(runRequest())
      });
      expect(missing.status).toBe(409);
      const accepted = await fetch(url, {
        method: "POST",
        headers: { authorization: "Bearer secret", "content-type": "application/json" },
        body: JSON.stringify({
          ...runRequest({ catalogDigest: `sha256:${"d".repeat(64)}` }),
          effectiveRunPolicy: effectiveRunPolicy({
            catalogDigest: `sha256:${"d".repeat(64)}`,
            platformPolicyDigest: policyDigest,
            resourceDigest
          })
        })
      });
      expect(accepted.status).toBe(200);
      expect(run).toHaveBeenCalledOnce();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("archives and destroys only the workspace named in the authenticated path", async () => {
    const archive = vi.fn().mockResolvedValue(undefined);
    const destroy = vi.fn().mockResolvedValue(undefined);
    const server = createRuntimeProvisionerServer({
      provisioner: { archive, destroy } as never,
      token: "secret",
      catalogDigest
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");
    const base = `http://127.0.0.1:${address.port}/v1/runtimes/workspace-1`;
    await fetch(`${base}/archive`, { method: "POST", headers: { authorization: "Bearer secret" } });
    await fetch(`${base}/destroy`, { method: "POST", headers: { authorization: "Bearer secret" } });
    expect(archive).toHaveBeenCalledWith("workspace-1");
    expect(destroy).toHaveBeenCalledWith("workspace-1");
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });
});

function runRequest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    id: "run-identity",
    catalogDigest,
    traceId: "trace-identity",
    sessionId: "session-identity",
    inputText: "hello",
    images: [],
    sourceReferences: [],
    timeoutSeconds: 60,
    priority: "interactive",
    ...overrides
  };
}

function effectiveRunPolicy(input: {
  catalogDigest: string;
  platformPolicyDigest: string;
  resourceDigest: string;
}) {
  return {
    schemaVersion: 2,
    ...input,
    runtimeImageId: `sha256:${"e".repeat(64)}`,
    policyDigest: `sha256:${"f".repeat(64)}`,
    workspaceId: "one",
    agentId: "brain",
    pluginIds: ["core"],
    capabilityIds: [],
    toolIds: [],
    skillPaths: [],
    extensionPaths: []
  };
}
