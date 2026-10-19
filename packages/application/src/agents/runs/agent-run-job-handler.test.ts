import { describe, expect, it, vi } from "vitest";
import type {
  AgentArtifactV1,
  AgentRunV1,
  InternalJobV1,
  PiRunRequestV1,
  PiRunResultV1,
  EffectiveRunPolicyV2
} from "@second-brain/contracts";

import { AgentRunJobHandler } from "./agent-run-job-handler.js";
import type { PiRunnerPort } from "../../ports.js";
import { INITIAL_AGENT_CATALOG } from "@second-brain/domain";

const policy: EffectiveRunPolicyV2 = {
  schemaVersion: 2,
  catalogDigest: INITIAL_AGENT_CATALOG.digest,
  platformPolicyDigest: `sha256:${"b".repeat(64)}`,
  resourceDigest: `sha256:${"c".repeat(64)}`,
  runtimeImageId: `sha256:${"d".repeat(64)}`,
  policyDigest: `sha256:${"e".repeat(64)}`,
  workspaceId: "workspace-1",
  agentId: "orchestrator",
  pluginIds: ["core"],
  capabilityIds: [],
  toolIds: ["workspace_read"],
  skillPaths: [],
  extensionPaths: []
};

const run: AgentRunV1 = {
  schemaVersion: 1,
  id: "run-1",
  workspaceId: "workspace-1",
  agentId: "orchestrator",
  catalogVersion: "1.0.0",
  catalogDigest: INITIAL_AGENT_CATALOG.digest,
  effectivePolicyDigest: policy.policyDigest,
  platformPolicyDigest: policy.platformPolicyDigest,
  resourceDigest: policy.resourceDigest,
  runtimeImageId: policy.runtimeImageId,
  status: "queued",
  rootRunId: "run-1",
  deadlineAt: "2026-08-18T21:00:00.000Z",
  timeoutSeconds: 60,
  tokenBudget: 100,
  createdAt: "2026-08-18T20:00:00.000Z"
};
const job: InternalJobV1 = {
  schemaVersion: 1,
  id: "job-1",
  workspaceId: "workspace-1",
  type: "run_agent",
  payload: { runId: "run-1", task: "Inspect", allowedTools: ["workspace_read"] },
  priority: 50,
  status: "running",
  attempts: 1,
  availableAt: "2026-08-18T20:00:00.000Z",
  idempotencyKey: "agent-run:workspace-1:grant-1",
  leaseOwner: "worker-1",
  leaseExpiresAt: "2026-08-18T20:01:00.000Z",
  effectiveRunPolicies: [policy]
};

describe("AgentRunJobHandler", () => {
  it("passes the durable capability ceiling to Pi and completes the run", async () => {
    const noticeOrigin = {
      conversationId: "!room:example",
      replyToExternalEventId: "$event:example",
      threadRootExternalEventId: "$root:example"
    };
    const updateRun = vi.fn(async (value: AgentRunV1) => value);
    const createArtifact = vi.fn(async (artifact: AgentArtifactV1) => artifact);
    const request = vi.fn(
      async (value: PiRunRequestV1): Promise<PiRunResultV1> => ({
        schemaVersion: 1,
        id: value.id,
        traceId: value.traceId,
        sessionId: value.sessionId,
        status: "completed",
        text: "Child result",
        generatedFiles: [
          {
            schemaVersion: 1,
            id: "file-1",
            purpose: "outbound",
            mediaType: "text/plain",
            sizeBytes: 8,
            sha256: "b".repeat(64),
            storageKey: "agent-runs/run-1/result.txt"
          }
        ],
        startedAt: "2026-08-18T20:00:00.000Z",
        finishedAt: "2026-08-18T20:00:01.000Z"
      })
    );
    const complete = vi.fn(async () => undefined);
    const authorize = vi.fn();
    const authorization = {
      run<T>(token: string, action: () => Promise<T>): Promise<T> {
        authorize(token);
        return action();
      }
    };
    const subject = new AgentRunJobHandler({
      runs: {
        getRun: async () => ({ ...run, noticeOrigin }),
        getGrant: async () => undefined,
        updateRun,
        createArtifact
      },
      pi: { run: request },
      jobs: { complete },
      workerId: "worker-1",
      clock: { now: () => new Date("2026-08-18T20:00:01.000Z") },
      ids: { nextId: (prefix) => `${prefix}-1` },
      activeCatalog: INITIAL_AGENT_CATALOG,
      authorization
    });

    await subject.process({ ...job, runAuthorization: "run-token" });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        delegatedToolPolicy: ["workspace_read"],
        noticeOrigin,
        sourceReferences: [
          {
            schemaVersion: 1,
            conversationId: "!room:example",
            externalEventId: "$event:example",
            attachmentIds: []
          }
        ],
        runAuthorization: "run-token"
      })
    );
    expect(authorize).toHaveBeenCalledWith("run-token");
    expect(updateRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "completed", resultText: "Child result" })
    );
    expect(createArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        producingRunId: "run-1",
        storageKey: "agent-runs/run-1/result.txt"
      })
    );
    expect(complete).toHaveBeenCalledWith({ jobId: "job-1", leaseOwner: "worker-1" });
  });

  it("records a failed terminal run before preserving retry handling", async () => {
    const updateRun = vi.fn(async (value: AgentRunV1) => value);
    const subject = new AgentRunJobHandler({
      runs: {
        getRun: async () => run,
        getGrant: async () => undefined,
        updateRun,
        createArtifact: async (artifact: AgentArtifactV1) => artifact
      },
      pi: {
        run: async () => {
          throw new Error("runtime unavailable");
        }
      },
      jobs: { complete: async () => undefined },
      workerId: "worker-1",
      clock: { now: () => new Date("2026-08-18T20:00:01.000Z") },
      ids: { nextId: (prefix) => `${prefix}-1` },
      activeCatalog: INITIAL_AGENT_CATALOG
    });

    await expect(subject.process(job)).rejects.toThrow("runtime unavailable");
    expect(updateRun).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("terminalizes a queued run whose deadline elapsed before execution", async () => {
    const updateRun = vi.fn(async (value: AgentRunV1) => value);
    const request = vi.fn<PiRunnerPort["run"]>();
    const subject = new AgentRunJobHandler({
      runs: {
        getRun: async () => run,
        getGrant: async () => undefined,
        updateRun,
        createArtifact: async (artifact: AgentArtifactV1) => artifact
      },
      pi: { run: request },
      jobs: { complete: vi.fn() },
      workerId: "worker-1",
      clock: { now: () => new Date("2026-08-18T21:00:01.000Z") },
      ids: { nextId: (prefix) => `${prefix}-1` },
      activeCatalog: INITIAL_AGENT_CATALOG
    });

    await expect(subject.process(job)).rejects.toThrow("deadline has expired");
    expect(updateRun).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed" }));
    expect(request).not.toHaveBeenCalled();
  });

  it("accepts a diagnostic catalog change when execution identities still match", async () => {
    const updateRun = vi.fn(async (value: AgentRunV1) => value);
    const request = vi.fn<PiRunnerPort["run"]>().mockResolvedValue({
      schemaVersion: 1,
      id: run.id,
      traceId: run.id,
      sessionId: `agent-run-${run.id}`,
      status: "completed",
      text: "ok",
      generatedFiles: [],
      startedAt: "2026-08-18T20:00:01.000Z",
      finishedAt: "2026-08-18T20:00:02.000Z"
    });
    const subject = new AgentRunJobHandler({
      runs: {
        getRun: async () => run,
        getGrant: async () => undefined,
        updateRun,
        createArtifact: async (artifact: AgentArtifactV1) => artifact
      },
      pi: { run: request },
      jobs: { complete: vi.fn() },
      workerId: "worker-1",
      clock: { now: () => new Date("2026-08-18T20:00:01.000Z") },
      ids: { nextId: (prefix) => `${prefix}-1` },
      activeCatalog: { ...INITIAL_AGENT_CATALOG, digest: `sha256:${"b".repeat(64)}` }
    });

    await expect(subject.process(job)).resolves.toBeUndefined();
    expect(updateRun).toHaveBeenCalledWith(expect.objectContaining({ status: "running" }));
    expect(request).toHaveBeenCalledOnce();
  });

  it("fails a legacy queued run before entering running state or invoking Pi", async () => {
    const {
      effectivePolicyDigest: _effectivePolicyDigest,
      platformPolicyDigest: _platformPolicyDigest,
      resourceDigest: _resourceDigest,
      runtimeImageId: _runtimeImageId,
      ...legacyRun
    } = run;
    const updateRun = vi.fn(async (value: AgentRunV1) => value);
    const request = vi.fn<PiRunnerPort["run"]>();
    const subject = new AgentRunJobHandler({
      runs: {
        getRun: async () => legacyRun,
        getGrant: async () => undefined,
        updateRun,
        createArtifact: async (artifact) => artifact
      },
      pi: { run: request },
      jobs: { complete: vi.fn() },
      workerId: "worker-1",
      clock: { now: () => new Date("2026-08-18T20:00:01.000Z") },
      ids: { nextId: (prefix) => `${prefix}-1` },
      activeCatalog: INITIAL_AGENT_CATALOG
    });

    await expect(subject.process(job)).rejects.toThrow(/no durable execution identity/i);
    expect(updateRun).not.toHaveBeenCalledWith(expect.objectContaining({ status: "running" }));
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects a delegated child whose durable root differs from its parent", async () => {
    const parent: AgentRunV1 = {
      ...run,
      id: "parent-run",
      rootRunId: "root-run",
      agentId: "orchestrator",
      status: "running"
    };
    const child: AgentRunV1 = {
      ...run,
      id: "child-run",
      rootRunId: "different-root",
      agentId: "brain",
      parentRunId: parent.id,
      delegationGrantId: "grant-1"
    };
    const childJob: InternalJobV1 = {
      ...job,
      payload: {
        runId: child.id,
        rootRunId: child.rootRunId,
        parentRunId: parent.id,
        task: "Inspect",
        allowedTools: [],
        readablePaths: [],
        writablePaths: []
      }
    };
    const request = vi.fn<PiRunnerPort["run"]>();
    const updateRun = vi.fn(async (value: AgentRunV1) => value);
    const subject = new AgentRunJobHandler({
      runs: {
        getRun: async (id) => (id === child.id ? child : id === parent.id ? parent : undefined),
        getGrant: async () => ({
          schemaVersion: 1,
          id: "grant-1",
          parentRunId: parent.id,
          workspaceId: child.workspaceId,
          childAgentId: child.agentId,
          allowedTools: [],
          readablePaths: [],
          writablePaths: [],
          timeoutSeconds: child.timeoutSeconds,
          tokenBudget: child.tokenBudget,
          expiresAt: child.deadlineAt
        }),
        updateRun,
        createArtifact: async (artifact: AgentArtifactV1) => artifact
      },
      pi: { run: request },
      jobs: { complete: vi.fn() },
      workerId: "worker-1",
      clock: { now: () => new Date("2026-08-18T20:00:01.000Z") },
      ids: { nextId: (prefix) => `${prefix}-1` },
      activeCatalog: INITIAL_AGENT_CATALOG
    });

    await expect(subject.process(childJob)).rejects.toThrow(/different root runs/i);
    expect(request).not.toHaveBeenCalled();
  });

  it("acquires and releases a workspace lease around delegated write work", async () => {
    const updateRun = vi.fn(async (value: AgentRunV1) => value);
    const acquire = vi.fn(async () => ({
      schemaVersion: 1 as const,
      id: "lease-1",
      workspaceId: "workspace-1",
      ownerRunId: "run-1",
      acquiredAt: "2026-08-18T20:00:00.000Z",
      expiresAt: "2026-08-18T20:01:00.000Z"
    }));
    const release = vi.fn(async () => undefined);
    const subject = new AgentRunJobHandler({
      runs: {
        getRun: async () => run,
        getGrant: async () => undefined,
        updateRun,
        createArtifact: async (artifact) => artifact
      },
      pi: {
        run: async (request) => ({
          schemaVersion: 1,
          id: request.id,
          traceId: request.traceId,
          sessionId: request.sessionId,
          status: "completed",
          generatedFiles: [],
          startedAt: "2026-08-18T20:00:00.000Z",
          finishedAt: "2026-08-18T20:00:01.000Z"
        })
      },
      jobs: { complete: async () => undefined },
      workerId: "worker-1",
      clock: { now: () => new Date("2026-08-18T20:00:01.000Z") },
      ids: { nextId: (prefix) => `${prefix}-1` },
      activeCatalog: INITIAL_AGENT_CATALOG,
      leases: { acquire, release }
    });

    await subject.process({
      ...job,
      payload: { ...job.payload, allowedTools: ["workspace_write"] }
    });

    expect(acquire).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      ownerRunId: "run-1",
      leaseMs: 60_000
    });
    expect(release).toHaveBeenCalledWith({ workspaceId: "workspace-1", ownerRunId: "run-1" });
  });
});
