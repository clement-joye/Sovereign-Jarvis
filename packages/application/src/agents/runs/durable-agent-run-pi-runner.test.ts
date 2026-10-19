import { describe, expect, it, vi } from "vitest";

import type {
  AgentRunV1,
  EffectiveRunPolicyV2,
  PiRunRequestV1,
  PiRunResultV1
} from "@second-brain/contracts";
import { INITIAL_AGENT_CATALOG } from "@second-brain/domain";

import { DurableAgentRunPiRunner } from "./durable-agent-run-pi-runner.js";
import { RootAgentRunLifecycle } from "./root-agent-run-lifecycle.js";
import type { PiRunnerPort } from "../../ports.js";

const now = new Date("2026-09-11T08:00:00.000Z");

describe("DurableAgentRunPiRunner", () => {
  it("persists an authorized root run before invoking Pi and records completion", async () => {
    const events: string[] = [];
    const createRun = vi.fn(async (run: AgentRunV1) => {
      events.push("created");
      return run;
    });
    const updateRun = vi.fn(async (run: AgentRunV1) => run);
    const delegate = runner(async (request) => {
      events.push("pi");
      return result(request, "completed");
    });
    const authorizationTokens: string[] = [];
    const authorization = {
      async run<T>(token: string, action: () => Promise<T>): Promise<T> {
        authorizationTokens.push(token);
        return action();
      }
    };
    const subject = new DurableAgentRunPiRunner(
      delegate,
      new RootAgentRunLifecycle(
        { createRun, getRun: vi.fn().mockResolvedValue(undefined), updateRun },
        INITIAL_AGENT_CATALOG,
        { now: () => now }
      ),
      authorization
    );

    await expect(subject.run(request())).resolves.toMatchObject({ status: "completed" });

    expect(events).toEqual(["created", "pi"]);
    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "job-1",
        workspaceId: "workspace-1",
        agentId: "brain",
        status: "running",
        rootRunId: "job-1",
        effectivePolicyDigest: effectivePolicy().policyDigest,
        platformPolicyDigest: effectivePolicy().platformPolicyDigest,
        resourceDigest: effectivePolicy().resourceDigest,
        runtimeImageId: effectivePolicy().runtimeImageId
      })
    );
    expect(updateRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "job-1", status: "completed", resultText: "done" })
    );
    expect(authorizationTokens).toEqual(["run-token"]);
  });

  it("leaves an existing delegated run under the child job handler's lifecycle", async () => {
    const delegated = {
      ...rootRun(),
      parentRunId: "parent-1",
      delegationGrantId: "grant-1"
    };
    const createRun = vi.fn();
    const updateRun = vi.fn();
    const delegate = runner(async (input) => result(input, "completed"));
    const subject = new DurableAgentRunPiRunner(
      delegate,
      new RootAgentRunLifecycle(
        { createRun, getRun: vi.fn().mockResolvedValue(delegated), updateRun },
        INITIAL_AGENT_CATALOG,
        { now: () => now }
      ),
      { run: async (_token, action) => action() }
    );

    await subject.run(request());

    expect(createRun).not.toHaveBeenCalled();
    expect(updateRun).not.toHaveBeenCalled();
  });

  it("records a failed root run when Pi throws", async () => {
    const updateRun = vi.fn(async (run: AgentRunV1) => run);
    const subject = new DurableAgentRunPiRunner(
      runner(async () => {
        throw new Error("runtime failed");
      }),
      new RootAgentRunLifecycle(
        {
          createRun: vi.fn(async (run: AgentRunV1) => run),
          getRun: vi.fn().mockResolvedValue(undefined),
          updateRun
        },
        INITIAL_AGENT_CATALOG,
        { now: () => now }
      ),
      { run: async (_token, action) => action() }
    );

    await expect(subject.run(request())).rejects.toThrow("runtime failed");
    expect(updateRun).toHaveBeenCalledWith(
      expect.objectContaining({ id: "job-1", status: "failed", completedAt: now.toISOString() })
    );
  });

  it("rejects an existing root run with a different durable root identity", async () => {
    const run = vi.fn();
    const delegate = runner(run);
    const subject = new DurableAgentRunPiRunner(
      delegate,
      new RootAgentRunLifecycle(
        {
          createRun: vi.fn(),
          getRun: vi.fn().mockResolvedValue({ ...rootRun(), rootRunId: "another-root" }),
          updateRun: vi.fn()
        },
        INITIAL_AGENT_CATALOG,
        { now: () => now }
      ),
      { run: async (_token, action) => action() }
    );

    await expect(subject.run(request())).rejects.toThrow(/root run identity/i);
    expect(run).not.toHaveBeenCalled();
  });
});

function request(): PiRunRequestV1 {
  return {
    schemaVersion: 1,
    id: "job-1",
    catalogDigest: INITIAL_AGENT_CATALOG.digest,
    workspaceId: "workspace-1",
    agentId: "brain",
    traceId: "trace-1",
    sessionId: "session-1",
    inputText: "hello",
    images: [],
    sourceReferences: [],
    timeoutSeconds: 60,
    tokenBudget: 1000,
    priority: "interactive",
    runAuthorization: "run-token",
    effectiveRunPolicy: effectivePolicy()
  };
}

function rootRun(): AgentRunV1 {
  return {
    schemaVersion: 1,
    id: "job-1",
    workspaceId: "workspace-1",
    agentId: "brain",
    catalogVersion: INITIAL_AGENT_CATALOG.version,
    catalogDigest: INITIAL_AGENT_CATALOG.digest,
    effectivePolicyDigest: effectivePolicy().policyDigest,
    platformPolicyDigest: effectivePolicy().platformPolicyDigest,
    resourceDigest: effectivePolicy().resourceDigest,
    runtimeImageId: effectivePolicy().runtimeImageId,
    status: "running",
    rootRunId: "job-1",
    deadlineAt: "2026-09-11T08:01:00.000Z",
    timeoutSeconds: 60,
    tokenBudget: 1000,
    createdAt: now.toISOString(),
    startedAt: now.toISOString()
  };
}

function effectivePolicy(): EffectiveRunPolicyV2 {
  return {
    schemaVersion: 2,
    catalogDigest: INITIAL_AGENT_CATALOG.digest,
    policyDigest: `sha256:${"b".repeat(64)}`,
    platformPolicyDigest: `sha256:${"c".repeat(64)}`,
    resourceDigest: `sha256:${"d".repeat(64)}`,
    runtimeImageId: `sha256:${"e".repeat(64)}`,
    workspaceId: "workspace-1",
    agentId: "brain",
    pluginIds: ["core"],
    capabilityIds: [],
    toolIds: [],
    skillPaths: [],
    extensionPaths: []
  };
}

function runner(run: PiRunnerPort["run"]): PiRunnerPort {
  return { run, cancel: vi.fn(), cancelSession: vi.fn() };
}

function result(input: PiRunRequestV1, status: PiRunResultV1["status"]): PiRunResultV1 {
  return {
    schemaVersion: 1,
    id: input.id,
    traceId: input.traceId,
    sessionId: input.sessionId,
    status,
    text: "done",
    generatedFiles: [],
    startedAt: now.toISOString(),
    finishedAt: now.toISOString()
  };
}
