import { describe, expect, it, vi } from "vitest";
import type { AgentRunV1, EffectiveRunPolicyV2, InternalJobV1 } from "@second-brain/contracts";
import { INITIAL_AGENT_CATALOG } from "@second-brain/domain";

import { handleJobRoute } from "./job-routes.js";
import { RunAuthorizationService } from "../authorization/run-authorization.js";

describe("job route run authorization", () => {
  it("renews job and admission leases with control-plane timing", async () => {
    const renew = vi.fn().mockResolvedValue(true);
    const writes: Array<{ status: number; body: unknown }> = [];
    await handleJobRoute(
      { method: "POST" } as never,
      {} as never,
      new URL("http://control.test/v1/jobs/job-1/heartbeat"),
      {
        jobs: {
          claim: vi.fn(),
          enqueue: vi.fn(),
          complete: vi.fn(),
          fail: vi.fn(),
          snapshot: vi.fn(),
          renew
        },
        rootAdmission: { limit: 1, leaseMs: 90_000, heartbeatMs: 30_000 },
        completeWithOutbound: vi.fn(),
        readJson: async () => ({ leaseOwner: "worker-1", leaseMs: 660_000 }),
        writeJson: (_response, status, body) => writes.push({ status, body })
      }
    );
    expect(renew).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "job-1", leaseOwner: "worker-1", leaseMs: 660_000 })
    );
    expect(writes).toEqual([{ status: 200, body: { ok: true } }]);
  });

  it("cancels a queued root without claiming admission", async () => {
    const cancelRootRun = vi.fn().mockResolvedValue(1);
    const writes: Array<{ status: number; body: unknown }> = [];
    await handleJobRoute(
      { method: "POST" } as never,
      {} as never,
      new URL("http://control.test/v1/jobs/root-1/cancel"),
      {
        jobs: {
          claim: vi.fn(),
          enqueue: vi.fn(),
          complete: vi.fn(),
          fail: vi.fn(),
          snapshot: vi.fn(),
          cancelRootRun
        },
        completeWithOutbound: vi.fn(),
        readJson: vi.fn(),
        writeJson: (_response, status, body) => writes.push({ status, body })
      }
    );
    expect(cancelRootRun).toHaveBeenCalledWith(
      expect.objectContaining({ rootRunId: "root-1", reason: "cancelled_by_control" })
    );
    expect(writes).toEqual([{ status: 200, body: { ok: true, cancelled: 1 } }]);
  });

  it("issues an ordinary claimed job only the selected agent's authority", async () => {
    const now = Date.now();
    const job: InternalJobV1 = {
      schemaVersion: 1,
      id: "job-browser-1",
      workspaceId: "workspace-1",
      type: "process_inbound",
      payload: { inboundMessageId: "inbound-1", agentId: "browser" },
      priority: 100,
      status: "leased",
      attempts: 1,
      availableAt: new Date(now).toISOString(),
      idempotencyKey: "inbound-1",
      leaseOwner: "worker-1",
      leaseExpiresAt: new Date(now + 60_000).toISOString()
    };
    const writes: Array<{ status: number; body: unknown }> = [];
    const authorizations = new RunAuthorizationService("a".repeat(32));

    await handleJobRoute(
      { method: "POST" } as never,
      {} as never,
      new URL("http://control.test/v1/jobs/claim"),
      {
        jobs: {
          claim: vi.fn().mockResolvedValue([job]),
          enqueue: vi.fn(),
          complete: vi.fn(),
          fail: vi.fn(),
          snapshot: vi.fn()
        },
        completeWithOutbound: vi.fn(),
        agentCatalog: INITIAL_AGENT_CATALOG,
        runAuthorizations: authorizations,
        effectiveRunPolicies: {
          resolve: vi.fn().mockResolvedValue({ ...policy("browser"), toolIds: ["websearch"] }),
          resolveIfActive: vi.fn()
        },
        readJson: async () => ({ workerId: "worker-1", leaseMs: 60_000 }),
        writeJson: (_response, status, body) => writes.push({ status, body })
      }
    );

    const claimed = (writes[0]?.body as InternalJobV1[])[0];
    expect(claimed?.runAuthorization).toBeDefined();
    expect(
      authorizations.verify(claimed?.runAuthorization, {
        runId: job.id,
        workspaceId: "workspace-1",
        agentId: "browser",
        requiredTool: "websearch"
      })
    ).toBeDefined();
    expect(
      authorizations.verify(claimed?.runAuthorization, {
        runId: job.id,
        workspaceId: "workspace-1",
        agentId: "brain"
      })
    ).toBeUndefined();
  });

  it("omits disabled plugin agents from a Router claim policy set", async () => {
    const now = Date.now();
    const job: InternalJobV1 = {
      schemaVersion: 1,
      id: "job-router-1",
      workspaceId: "workspace-1",
      type: "process_inbound",
      payload: { inboundMessageId: "inbound-1", agentId: "router" },
      priority: 100,
      status: "leased",
      attempts: 1,
      availableAt: new Date(now).toISOString(),
      idempotencyKey: "inbound-router-1",
      leaseOwner: "worker-1",
      leaseExpiresAt: new Date(now + 60_000).toISOString()
    };
    const writes: Array<{ status: number; body: unknown }> = [];
    const authorizations = new RunAuthorizationService("b".repeat(32));
    const resolveIfActive = vi.fn(async ({ agentId }: { agentId: string }) =>
      agentId === "git" ? undefined : policy(agentId)
    );

    await handleJobRoute(
      { method: "POST" } as never,
      {} as never,
      new URL("http://control.test/v1/jobs/claim"),
      {
        jobs: {
          claim: vi.fn().mockResolvedValue([job]),
          enqueue: vi.fn(),
          complete: vi.fn(),
          fail: vi.fn(),
          snapshot: vi.fn()
        },
        completeWithOutbound: vi.fn(),
        agentCatalog: INITIAL_AGENT_CATALOG,
        runAuthorizations: authorizations,
        effectiveRunPolicies: { resolve: vi.fn(), resolveIfActive },
        readJson: async () => ({ workerId: "worker-1", leaseMs: 60_000 }),
        writeJson: (_response, status, body) => writes.push({ status, body })
      }
    );

    const claimed = (writes[0]?.body as InternalJobV1[])[0];
    expect(claimed?.effectiveRunPolicies?.map(({ agentId }) => agentId)).not.toContain("git");
    expect(resolveIfActive).toHaveBeenCalledTimes(INITIAL_AGENT_CATALOG.ids().length);
    expect(
      authorizations.verify(claimed?.runAuthorization, {
        runId: job.id,
        workspaceId: "workspace-1",
        requiredTool: "workspace_read"
      })
    ).toBeDefined();
  });

  it("terminalizes a delegated job when claim-time plugin authorization is disabled", async () => {
    const now = Date.now();
    const job: InternalJobV1 = {
      schemaVersion: 1,
      id: "job-browser-1",
      workspaceId: "workspace-1",
      type: "run_agent",
      payload: { runId: "run-browser-1", allowedTools: ["websearch"] },
      priority: 50,
      status: "leased",
      attempts: 0,
      availableAt: new Date(now).toISOString(),
      idempotencyKey: "browser-1",
      leaseOwner: "delegation-worker",
      leaseExpiresAt: new Date(now + 60_000).toISOString()
    };
    const run: AgentRunV1 = {
      schemaVersion: 1,
      id: "run-browser-1",
      workspaceId: "workspace-1",
      agentId: "browser",
      catalogVersion: INITIAL_AGENT_CATALOG.version,
      catalogDigest: INITIAL_AGENT_CATALOG.digest,
      status: "queued",
      rootRunId: "run-planner-1",
      parentRunId: "run-planner-1",
      delegationGrantId: "grant-1",
      deadlineAt: new Date(now + 60_000).toISOString(),
      timeoutSeconds: 60,
      tokenBudget: 1_000,
      createdAt: new Date(now).toISOString()
    };
    const fail = vi.fn().mockResolvedValue({ ...job, status: "dead_letter" as const });
    const updateRun = vi.fn(async (updated: AgentRunV1) => updated);
    const writes: Array<{ status: number; body: unknown }> = [];

    await handleJobRoute(
      { method: "POST" } as never,
      {} as never,
      new URL("http://control.test/v1/jobs/claim"),
      {
        jobs: {
          claim: vi.fn().mockResolvedValue([job]),
          enqueue: vi.fn(),
          complete: vi.fn(),
          fail,
          snapshot: vi.fn()
        },
        completeWithOutbound: vi.fn(),
        agentCatalog: INITIAL_AGENT_CATALOG,
        runs: { getRun: vi.fn().mockResolvedValue(run), updateRun },
        runAuthorizations: new RunAuthorizationService("c".repeat(32)),
        effectiveRunPolicies: {
          resolve: vi
            .fn()
            .mockRejectedValue(
              new Error("Agent plugin is disabled for this workspace: browser/browser.")
            ),
          resolveIfActive: vi.fn()
        },
        readJson: async () => ({ workerId: "delegation-worker", leaseMs: 60_000 }),
        writeJson: (_response, status, body) => writes.push({ status, body })
      }
    );

    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: job.id, retryable: false, maxAttempts: 1 })
    );
    expect(updateRun).toHaveBeenCalledWith(
      expect.objectContaining({ id: run.id, status: "failed" })
    );
    expect(writes).toEqual([{ status: 200, body: [] }]);
  });
});

function policy(agentId: string): EffectiveRunPolicyV2 {
  return {
    schemaVersion: 2,
    catalogDigest: INITIAL_AGENT_CATALOG.digest,
    platformPolicyDigest: `sha256:${"d".repeat(64)}`,
    resourceDigest: `sha256:${"e".repeat(64)}`,
    runtimeImageId: `sha256:${"f".repeat(64)}`,
    policyDigest: `sha256:${"c".repeat(64)}`,
    workspaceId: "workspace-1",
    agentId,
    pluginIds: ["core"],
    capabilityIds: ["workspace-read"],
    toolIds: ["workspace_read"],
    skillPaths: [],
    extensionPaths: []
  };
}
