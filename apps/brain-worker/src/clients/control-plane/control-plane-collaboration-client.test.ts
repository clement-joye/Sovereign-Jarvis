import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HttpAgentCollaborationRepository,
  HttpWorkspaceWriteLeaseRepository
} from "./control-plane-collaboration-client.js";

const digest = `sha256:${"a".repeat(64)}`;

describe("worker collaboration HTTP clients", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends its bearer token when reading a run", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(run()));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      new HttpAgentCollaborationRepository("http://control.test", "worker-token").getRun("run-1")
    ).resolves.toEqual(run());
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/v1/internal/agent-collaboration/runs/run-1", "http://control.test"),
      expect.objectContaining({ headers: { authorization: "Bearer worker-token" } })
    );
  });

  it("creates a root run with the scoped run authorization", async () => {
    const rootRun = { ...run(), status: "running" as const };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(rootRun));
    vi.stubGlobal("fetch", fetchMock);
    const collaboration = new HttpAgentCollaborationRepository(
      "http://control.test",
      "worker-token"
    );

    await collaboration.run("run-token", () => collaboration.createRun(rootRun));

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/v1/internal/agent-collaboration/runs", "http://control.test"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer worker-token",
          "x-jarvis-run-authorization": "run-token"
        })
      })
    );
  });

  it("maps an authenticated lease conflict to an unavailable lease", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response("conflict", { status: 409 }))
    );
    await expect(
      new HttpWorkspaceWriteLeaseRepository("http://control.test", "worker-token").acquire(lease())
    ).resolves.toBeUndefined();
  });

  it("retrieves the durable grant needed to validate a delegated run", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(grant()));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      new HttpAgentCollaborationRepository("http://control.test", "worker-token").getGrant(
        "grant-1"
      )
    ).resolves.toEqual(grant());
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/v1/internal/agent-collaboration/grants/grant-1", "http://control.test"),
      expect.objectContaining({ headers: { authorization: "Bearer worker-token" } })
    );
  });

  it("scopes run authorization to collaboration and lease mutations", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (request) => {
      const requestUrl =
        typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
      const path = new URL(requestUrl).pathname;
      return jsonResponse(path.includes("/leases") ? lease() : { ...run(), status: "running" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const collaboration = new HttpAgentCollaborationRepository(
      "http://control.test",
      "worker-token"
    );
    const leases = new HttpWorkspaceWriteLeaseRepository(
      "http://control.test",
      "worker-token",
      undefined,
      collaboration
    );

    await collaboration.run("run-token", async () => {
      await collaboration.updateRun({ ...run(), status: "running" });
      await leases.acquire(lease());
    });
    await collaboration.getRun("run-1");

    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ "x-jarvis-run-authorization": "run-token" })
      })
    );
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ "x-jarvis-run-authorization": "run-token" })
      })
    );
    expect(fetchMock.mock.calls[2]?.[1]).toEqual(
      expect.objectContaining({ headers: { authorization: "Bearer worker-token" } })
    );
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function run() {
  return {
    schemaVersion: 1 as const,
    id: "run-1",
    workspaceId: "workspace-1",
    agentId: "document-analyzer",
    catalogVersion: "1.0.0",
    catalogDigest: digest,
    status: "queued" as const,
    rootRunId: "run-1",
    deadlineAt: "2026-08-19T12:00:00.000Z",
    timeoutSeconds: 60,
    tokenBudget: 1000,
    createdAt: "2026-08-19T11:00:00.000Z"
  };
}

function lease() {
  return {
    schemaVersion: 1 as const,
    id: "lease-1",
    workspaceId: "workspace-1",
    ownerRunId: "run-1",
    acquiredAt: "2026-08-19T11:00:00.000Z",
    expiresAt: "2026-08-19T11:01:00.000Z"
  };
}

function grant() {
  return {
    schemaVersion: 1,
    id: "grant-1",
    parentRunId: "parent-1",
    workspaceId: "workspace-1",
    childAgentId: "document-analyzer",
    allowedTools: ["workspace_read"],
    readablePaths: ["documents"],
    writablePaths: [],
    timeoutSeconds: 60,
    tokenBudget: 1000,
    expiresAt: "2026-08-19T12:00:00.000Z"
  };
}
