import { describe, expect, it, vi } from "vitest";

import { handleWorkerCollaborationRoute } from "./worker-collaboration-routes.js";

const digest = `sha256:${"a".repeat(64)}`;
const run = {
  schemaVersion: 1 as const,
  id: "run-1",
  workspaceId: "workspace-1",
  agentId: "fixture-agent",
  catalogVersion: "1.0.0",
  catalogDigest: digest,
  status: "queued" as const,
  rootRunId: "run-1",
  deadlineAt: "2026-08-19T12:00:00.000Z",
  timeoutSeconds: 60,
  tokenBudget: 1000,
  createdAt: "2026-08-19T11:00:00.000Z"
};

describe("worker collaboration routes", () => {
  it("rejects an unauthenticated worker before reading a request", async () => {
    const readJson = vi.fn();
    const writeJson = vi.fn();
    await expect(
      handleWorkerCollaborationRoute(
        { method: "GET", headers: {} } as never,
        {} as never,
        new URL("http://brain-control.local/v1/internal/agent-collaboration/runs/run-1"),
        { runs: {} as never, leases: {} as never, token: "worker-token", readJson, writeJson }
      )
    ).resolves.toBe(true);
    expect(readJson).not.toHaveBeenCalled();
    expect(writeJson).toHaveBeenCalledWith(expect.anything(), 401, {
      error: "agent_collaboration_unauthorized"
    });
  });

  it("updates a durable run through the authenticated worker boundary", async () => {
    const updateRun = vi.fn().mockResolvedValue({ ...run, status: "running" });
    const writes: Array<{ status: number; body: unknown }> = [];
    await expect(
      handleWorkerCollaborationRoute(
        { method: "PUT", headers: { authorization: "Bearer worker-token" } } as never,
        {} as never,
        new URL("http://brain-control.local/v1/internal/agent-collaboration/runs/run-1"),
        {
          runs: { updateRun } as never,
          leases: {} as never,
          token: "worker-token",
          runAuthorizations: { verify: vi.fn().mockReturnValue(true) } as never,
          readJson: async () => ({
            ...run,
            status: "running",
            startedAt: "2026-08-19T11:01:00.000Z"
          }),
          writeJson: (_response, status, body) => writes.push({ status, body })
        }
      )
    ).resolves.toBe(true);
    expect(updateRun).toHaveBeenCalledWith(
      expect.objectContaining({ id: "run-1", status: "running" })
    );
    expect(writes).toEqual([{ status: 200, body: { ...run, status: "running" } }]);
  });

  it("creates an authorized root run before broker-backed tools can execute", async () => {
    const rootRun = { ...run, status: "running" as const };
    const createRun = vi.fn().mockResolvedValue(rootRun);
    const verify = vi.fn().mockReturnValue({
      jobId: "run-1",
      runId: "run-1",
      catalogDigest: digest
    });
    const writeJson = vi.fn();

    await expect(
      handleWorkerCollaborationRoute(
        {
          method: "POST",
          headers: {
            authorization: "Bearer worker-token",
            "x-jarvis-run-authorization": "run-token"
          }
        } as never,
        {} as never,
        new URL("http://brain-control.local/v1/internal/agent-collaboration/runs"),
        {
          runs: { createRun } as never,
          leases: {} as never,
          token: "worker-token",
          runAuthorizations: { verify } as never,
          readJson: async () => rootRun,
          writeJson
        }
      )
    ).resolves.toBe(true);

    expect(verify).toHaveBeenCalledWith("run-token", {
      runId: "run-1",
      workspaceId: "workspace-1",
      agentId: "fixture-agent"
    });
    expect(createRun).toHaveBeenCalledWith(rootRun);
    expect(writeJson).toHaveBeenCalledWith(expect.anything(), 201, rootRun);
  });

  it("does not let a delegated job token create a root run", async () => {
    const createRun = vi.fn();
    const writeJson = vi.fn();

    await handleWorkerCollaborationRoute(
      {
        method: "POST",
        headers: {
          authorization: "Bearer worker-token",
          "x-jarvis-run-authorization": "child-token"
        }
      } as never,
      {} as never,
      new URL("http://brain-control.local/v1/internal/agent-collaboration/runs"),
      {
        runs: { createRun } as never,
        leases: {} as never,
        token: "worker-token",
        runAuthorizations: {
          verify: vi.fn().mockReturnValue({
            jobId: "child-job-1",
            runId: "run-1",
            catalogDigest: digest
          })
        } as never,
        readJson: async () => ({ ...run, status: "running" }),
        writeJson
      }
    );

    expect(createRun).not.toHaveBeenCalled();
    expect(writeJson).toHaveBeenCalledWith(expect.anything(), 403, {
      error: "agent_run_forbidden"
    });
  });

  it("returns a durable grant through the authenticated worker boundary", async () => {
    const grant = { id: "grant-1", parentRunId: "parent-1" };
    const writeJson = vi.fn();
    await expect(
      handleWorkerCollaborationRoute(
        { method: "GET", headers: { authorization: "Bearer worker-token" } } as never,
        {} as never,
        new URL("http://brain-control.local/v1/internal/agent-collaboration/grants/grant-1"),
        {
          runs: { getGrant: vi.fn().mockResolvedValue(grant) } as never,
          leases: {} as never,
          token: "worker-token",
          readJson: vi.fn(),
          writeJson
        }
      )
    ).resolves.toBe(true);
    expect(writeJson).toHaveBeenCalledWith(expect.anything(), 200, grant);
  });
});
