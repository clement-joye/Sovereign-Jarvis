import { describe, expect, it, vi } from "vitest";
import type { AgentRunV1, InternalJobV1, OutboundMessageV1 } from "@second-brain/contracts";

import { handlePlannerDelegationRoute, waitForChild } from "./planner-delegation-routes.js";
import { RunAuthorizationService } from "../authorization/run-authorization.js";

const run = {
  schemaVersion: 1 as const,
  id: "run-1",
  workspaceId: "workspace-1",
  agentId: "planner",
  catalogVersion: "1.0.0",
  catalogDigest: `sha256:${"a".repeat(64)}`,
  status: "cancelled" as const,
  rootRunId: "run-1",
  deadlineAt: "2026-08-19T12:00:00.000Z",
  timeoutSeconds: 60,
  tokenBudget: 1000,
  createdAt: "2026-08-19T11:00:00.000Z",
  completedAt: "2026-08-19T11:01:00.000Z"
};

const delegationSpec = {
  targetAgentId: "brain",
  task: "State your mission in one sentence.",
  allowedTools: [],
  readablePaths: [],
  writablePaths: []
};

describe("planner delegation routes", () => {
  it("returns no result when a child remains active past the delegation deadline", async () => {
    await expect(
      waitForChild({ getRun: async () => undefined }, { ...run, status: "queued" }, 0)
    ).resolves.toBeUndefined();
  });

  it("accepts Planner-to-Brain delegation with no tool grant", async () => {
    const { runAuthorizations, token } = authorizationFixture(["delegate"]);
    const writes: Array<{ status: number; body: unknown }> = [];
    const createRun = vi.fn(async () => ({ ...run, status: "running" as const }));
    const child = { ...run, id: "run-child", agentId: "brain", status: "queued" as const };
    const delegate = vi.fn(async () => child);

    await expect(
      handlePlannerDelegationRoute(
        { method: "POST", headers: { authorization: `Bearer ${token}` } } as never,
        {} as never,
        new URL("http://brain-control.local/v1/planner-delegations"),
        {
          runs: {
            createRun,
            getRun: async () => ({ ...child, status: "completed" as const, resultText: "Mission." })
          } as never,
          planner: { delegate } as never,
          runAuthorizations,
          readJson: async () => ({
            parent: { ...run, status: "running", startedAt: run.createdAt },
            spec: delegationSpec
          }),
          writeJson: (_response, status, body) => writes.push({ status, body })
        }
      )
    ).resolves.toBe(true);

    expect(delegate).toHaveBeenCalledWith(
      expect.objectContaining({
        spec: expect.objectContaining({ targetAgentId: "brain", allowedTools: [] })
      })
    );
    expect(writes).toEqual([
      { status: 201, body: expect.objectContaining({ id: "run-child", resultText: "Mission." }) }
    ]);
  });

  it("persists an immediate delegation notice in the root run's originating thread", async () => {
    const { runAuthorizations, token } = authorizationFixture(["delegate"]);
    const origin = {
      conversationId: "!origin:example",
      replyToExternalEventId: "$reply-event",
      threadRootExternalEventId: "$thread-root"
    };
    const child = {
      ...run,
      id: "run-child",
      agentId: "document-analyzer",
      status: "queued" as const
    };
    const createOutbound = vi.fn(async (outbound: OutboundMessageV1) => outbound);
    const enqueue = vi.fn(async (job: InternalJobV1) => job);
    const claimDelegationNotice = vi.fn(async () => true);

    await handlePlannerDelegationRoute(
      { method: "POST", headers: { authorization: `Bearer ${token}` } } as never,
      {} as never,
      new URL("http://brain-control.local/v1/planner-delegations"),
      {
        runs: {
          claimDelegationNotice,
          createRun: vi.fn(async (parent: AgentRunV1) => parent),
          getRun: async () => ({ ...child, status: "completed" as const })
        } as never,
        planner: { delegate: vi.fn().mockResolvedValue(child) } as never,
        runAuthorizations,
        outbounds: { create: createOutbound } as never,
        jobs: { enqueue } as never,
        readJson: async () => ({
          parent: { ...run, status: "running", startedAt: run.createdAt, noticeOrigin: origin },
          spec: delegationSpec
        }),
        writeJson: vi.fn()
      }
    );

    expect(createOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "!origin:example",
        replyToExternalEventId: "$reply-event",
        threadRootExternalEventId: "$thread-root",
        text: "Delegating to Document Analyzer…",
        presentation: "notice",
        idempotencyKey: "planner_delegation:run-1:run-child:started"
      })
    );
    expect(claimDelegationNotice).toHaveBeenCalledWith("run-1", "run-child", 3);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "progress_notice",
        workspaceId: "workspace-1",
        payload: { rootRunId: "run-1" },
        availableAt: "2026-08-19T11:00:35.000Z",
        idempotencyKey: "progress_notice:workspace-1:run-1"
      })
    );
  });

  it("rejects a disabled delegation target before creating a child", async () => {
    const { runAuthorizations, token } = authorizationFixture(["delegate"]);
    const delegate = vi.fn();
    const createRun = vi.fn();
    const writeJson = vi.fn();

    await handlePlannerDelegationRoute(
      { method: "POST", headers: { authorization: `Bearer ${token}` } } as never,
      {} as never,
      new URL("http://brain-control.local/v1/planner-delegations"),
      {
        runs: { createRun } as never,
        planner: { delegate } as never,
        runAuthorizations,
        effectiveRunPolicies: {
          resolve: vi
            .fn()
            .mockRejectedValue(
              new Error("Agent plugin is disabled for this workspace: browser/browser.")
            )
        },
        readJson: async () => ({
          parent: { ...run, status: "running", startedAt: run.createdAt },
          spec: { ...delegationSpec, targetAgentId: "browser" }
        }),
        writeJson
      }
    );

    expect(createRun).not.toHaveBeenCalled();
    expect(delegate).not.toHaveBeenCalled();
    expect(writeJson).toHaveBeenCalledWith(
      expect.anything(),
      409,
      expect.objectContaining({ error: "delegation_target_unavailable" })
    );
  });

  it("cancels a child that remains active when synchronous waiting expires", async () => {
    const { runAuthorizations, token } = authorizationFixture(["delegate"]);
    const child = { ...run, id: "run-child", agentId: "brain", status: "queued" as const };
    const cancel = vi.fn().mockResolvedValue({ ...child, status: "cancelled" });
    const writeJson = vi.fn();

    await handlePlannerDelegationRoute(
      { method: "POST", headers: { authorization: `Bearer ${token}` } } as never,
      {} as never,
      new URL("http://brain-control.local/v1/planner-delegations"),
      {
        runs: { createRun: vi.fn(async (parent: AgentRunV1) => parent) } as never,
        planner: { delegate: vi.fn().mockResolvedValue(child) } as never,
        cancellation: { cancel } as never,
        runAuthorizations,
        waitForChild: vi.fn().mockResolvedValue(undefined),
        readJson: async () => ({
          parent: { ...run, status: "running", startedAt: run.createdAt },
          spec: delegationSpec
        }),
        writeJson
      }
    );

    expect(cancel).toHaveBeenCalledWith("run-child");
    expect(writeJson).toHaveBeenCalledWith(
      expect.anything(),
      504,
      expect.objectContaining({ error: "planner_delegation_timeout" })
    );
  });

  it("exposes durable run-tree cancellation through the control plane", async () => {
    const { runAuthorizations, token } = authorizationFixture(["delegate_status"]);
    const cancel = vi.fn().mockResolvedValue(run);
    const writes: Array<{ status: number; body: unknown }> = [];

    await expect(
      handlePlannerDelegationRoute(
        { method: "POST", headers: { authorization: `Bearer ${token}` } } as never,
        {} as never,
        new URL("http://brain-control.local/v1/agent-runs/run-1/cancel"),
        {
          runs: { getRun: async () => run } as never,
          planner: {} as never,
          cancellation: { cancel } as never,
          runAuthorizations,
          readJson: async () => undefined,
          writeJson: (_response, status, body) => writes.push({ status, body })
        }
      )
    ).resolves.toBe(true);

    expect(cancel).toHaveBeenCalledWith("run-1");
    expect(writes).toEqual([{ status: 200, body: run }]);
  });

  it("does not reveal whether an unauthorized cancellation target exists", async () => {
    const { runAuthorizations, token } = authorizationFixture(["delegate_status"]);
    const writeJson = vi.fn();
    await handlePlannerDelegationRoute(
      { method: "POST", headers: { authorization: `Bearer ${token}` } } as never,
      {} as never,
      new URL("http://brain-control.local/v1/agent-runs/missing/cancel"),
      {
        runs: { getRun: async () => undefined } as never,
        planner: {} as never,
        cancellation: { cancel: async () => undefined } as never,
        runAuthorizations,
        readJson: async () => undefined,
        writeJson
      }
    );
    expect(writeJson).toHaveBeenCalledWith(expect.anything(), 403, {
      error: "planner_delegation_forbidden"
    });
  });

  it("rejects an unauthenticated delegation request before reading its body", async () => {
    const readJson = vi.fn();
    const writeJson = vi.fn();
    await handlePlannerDelegationRoute(
      { method: "POST", headers: {} } as never,
      {} as never,
      new URL("http://brain-control.local/v1/planner-delegations"),
      {
        runs: {} as never,
        planner: {} as never,
        readJson,
        writeJson
      }
    );
    expect(readJson).not.toHaveBeenCalled();
    expect(writeJson).toHaveBeenCalledWith(expect.anything(), 401, {
      error: "planner_delegation_unauthorized"
    });
  });

  it("returns field-level details for an invalid delegation request", async () => {
    const { runAuthorizations, token } = authorizationFixture(["delegate"]);
    const writeJson = vi.fn();
    await handlePlannerDelegationRoute(
      { method: "POST", headers: { authorization: `Bearer ${token}` } } as never,
      {} as never,
      new URL("http://brain-control.local/v1/planner-delegations"),
      {
        runs: {} as never,
        planner: {} as never,
        runAuthorizations,
        readJson: async () => ({ parent: {}, spec: {} }),
        writeJson
      }
    );
    expect(writeJson).toHaveBeenCalledWith(
      expect.anything(),
      400,
      expect.objectContaining({
        error: "invalid_planner_delegation",
        parentIssues: expect.any(Array),
        specIssues: expect.any(Array)
      })
    );
  });

  it("does not intercept unrelated control-plane routes", async () => {
    const writeJson = vi.fn();
    await expect(
      handlePlannerDelegationRoute(
        { method: "POST", headers: {} } as never,
        {} as never,
        new URL("http://brain-control.local/v1/jobs/claim"),
        {
          runs: {} as never,
          planner: {} as never,
          readJson: async () => undefined,
          writeJson
        }
      )
    ).resolves.toBe(false);
    expect(writeJson).not.toHaveBeenCalled();
  });

  it("rejects the former static delegation bearer even when signed authorization is configured", async () => {
    const { runAuthorizations } = authorizationFixture(["delegate"]);
    const delegate = vi.fn();
    const writeJson = vi.fn();

    await handlePlannerDelegationRoute(
      { method: "POST", headers: { authorization: "Bearer delegation-token" } } as never,
      {} as never,
      new URL("http://brain-control.local/v1/planner-delegations"),
      {
        runs: {} as never,
        planner: { delegate } as never,
        runAuthorizations,
        readJson: async () => ({
          parent: { ...run, status: "running", startedAt: run.createdAt },
          spec: delegationSpec
        }),
        writeJson
      }
    );

    expect(delegate).not.toHaveBeenCalled();
    expect(writeJson).toHaveBeenCalledWith(expect.anything(), 403, {
      error: "planner_delegation_forbidden"
    });
  });
});

function authorizationFixture(allowedTools: string[]) {
  const runAuthorizations = new RunAuthorizationService(
    "planner-route-test-signing-secret-at-least-32-bytes",
    () => new Date("2026-08-19T11:00:00.000Z")
  );
  const token = runAuthorizations.issue({
    jobId: "job-1",
    runId: run.id,
    workspaceId: run.workspaceId,
    agentId: run.agentId,
    catalogDigest: run.catalogDigest,
    executionIdentities: [
      {
        agentId: run.agentId,
        allowedTools,
        effectivePolicyDigest: `sha256:${"b".repeat(64)}`,
        platformPolicyDigest: `sha256:${"c".repeat(64)}`,
        resourceDigest: `sha256:${"d".repeat(64)}`,
        runtimeImageId: `sha256:${"e".repeat(64)}`
      }
    ],
    leaseOwner: "worker-1",
    allowedTools,
    expiresAt: "2026-08-19T11:05:00.000Z"
  });
  return { runAuthorizations, token };
}
