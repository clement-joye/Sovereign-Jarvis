import { once } from "node:events";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { INITIAL_AGENT_CATALOG } from "@second-brain/domain";
import { exampleInboundMessage, type EffectiveRunPolicyV2 } from "@second-brain/contracts";
import {
  HttpAgentCollaborationRepository,
  HttpJobQueue,
  HttpWorkspaceWriteLeaseRepository
} from "@second-brain/brain-worker";

describe("durable sub-agent worker flow", () => {
  it("persists delegated work, its artifact, and its exclusive lease through the worker boundary", async () => {
    const token = "worker-collaboration-token";
    const control = await startBrainControl(token);
    try {
      const invite = await fetch(`${control.baseUrl}/v1/workspaces/accept-trusted-invite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomId: "!admission:example" })
      });
      const { workspaceId } = (await invite.json()) as { workspaceId: string };
      const inbound = await fetch(`${control.baseUrl}/v1/inbound/matrix`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...exampleInboundMessage,
          id: "inbound-root-admission",
          agentId: "orchestrator",
          workspaceId,
          conversationId: "!admission:example",
          externalEventId: "$root-admission",
          threadRootExternalEventId: "$thread"
        })
      });
      expect(inbound.status).toBe(202);
      const jobs = new HttpJobQueue(control.baseUrl);
      const [rootJob] = await jobs.claim({
        workerId: "root-worker-integration",
        limit: 1,
        now: new Date(),
        leaseMs: 30_000,
        jobTypes: ["process_inbound"]
      });
      if (!rootJob) throw new Error("Expected admitted root job.");
      if (!rootJob.runAuthorization) throw new Error("Expected root run authorization.");
      const parent = parentRun(rootJob.id, workspaceId);
      const responsePromise = fetch(`${control.baseUrl}/v1/planner-delegations`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${rootJob.runAuthorization}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          parent,
          spec: {
            targetAgentId: "document-analyzer",
            task: "Analyze the provided documents and produce a durable report.",
            allowedTools: ["workspace_write"],
            readablePaths: ["documents"],
            writablePaths: ["documents"]
          }
        })
      });
      // The HTTP request and job claim run concurrently; a fast client can
      // claim before the server has committed the delegated job.
      void responsePromise.catch(() => {});
      const job = await claimDelegatedJob(jobs);
      expect(job).toMatchObject({
        type: "run_agent",
        payload: { rootRunId: parent.id, parentRunId: parent.id }
      });
      if (!job?.runAuthorization) throw new Error("Expected claimed run authorization.");
      const childId = job?.payload.runId as string | undefined;
      if (!childId) throw new Error("Expected delegated child run id.");

      const runs = new HttpAgentCollaborationRepository(control.baseUrl, token);
      const leaseRepository = new HttpWorkspaceWriteLeaseRepository(
        control.baseUrl,
        token,
        undefined,
        runs
      );
      const queued = await runs.getRun(childId);
      expect(queued).toMatchObject({ status: "queued", parentRunId: parent.id });
      const lease = {
        schemaVersion: 1 as const,
        id: "lease-integration",
        workspaceId: queued!.workspaceId,
        ownerRunId: childId,
        acquiredAt: "2026-08-19T11:00:00.000Z",
        expiresAt: "2026-08-19T11:01:00.000Z"
      };
      await runs.run(job.runAuthorization, async () => {
        await expect(leaseRepository.acquire(lease)).resolves.toEqual(lease);
        await expect(leaseRepository.release(lease)).resolves.toBe(true);

        await runs.updateRun({
          ...queued!,
          status: "completed",
          startedAt: "2026-08-19T11:00:00.000Z",
          completedAt: "2026-08-19T11:00:01.000Z",
          resultText: "The child completed the delegated plan."
        });
        await runs.createArtifact({
          schemaVersion: 1,
          id: "artifact-integration",
          workspaceId: queued!.workspaceId,
          producingRunId: childId,
          parentRunId: parent.id,
          agentId: "document-analyzer",
          catalogVersion: INITIAL_AGENT_CATALOG.version,
          catalogDigest: INITIAL_AGENT_CATALOG.digest,
          kind: "plan",
          storageKey: "agent-runs/result.md",
          sha256: "b".repeat(64),
          createdAt: "2026-08-19T11:00:01.000Z"
        });
      });
      await jobs.complete({ jobId: job!.id, leaseOwner: "worker-integration" });
      await jobs.complete({ jobId: rootJob.id, leaseOwner: "root-worker-integration" });

      const response = await responsePromise;
      expect(response.status).toBe(201);
      const child = (await response.json()) as { id: string; resultText?: string };
      expect(child).toMatchObject({
        id: childId,
        resultText: "The child completed the delegated plan."
      });

      const status = await fetch(`${control.baseUrl}/v1/agent-runs/${parent.id}/children`, {
        headers: { authorization: `Bearer ${rootJob.runAuthorization}` }
      });
      expect(status.status).toBe(200);
      await expect(status.json()).resolves.toEqual([
        expect.objectContaining({
          run: expect.objectContaining({ id: child.id, status: "completed" }),
          artifacts: [expect.objectContaining({ id: "artifact-integration", kind: "plan" })]
        })
      ]);
    } finally {
      await control.close();
    }
  });
});

async function claimDelegatedJob(jobs: HttpJobQueue) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [job] = await jobs.claim({
      workerId: "worker-integration",
      limit: 1,
      now: new Date(),
      leaseMs: 30_000,
      jobTypes: ["run_agent"]
    });
    if (job) return job;
    await setTimeout(25);
  }
  throw new Error("Delegated run job was not queued within 5 seconds.");
}

function parentRun(id: string, workspaceId: string) {
  const now = new Date();
  return {
    schemaVersion: 1,
    id,
    workspaceId,
    agentId: "orchestrator",
    catalogVersion: INITIAL_AGENT_CATALOG.version,
    catalogDigest: INITIAL_AGENT_CATALOG.digest,
    status: "running",
    rootRunId: id,
    deadlineAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    timeoutSeconds: 300,
    tokenBudget: 45_000,
    createdAt: now.toISOString(),
    startedAt: now.toISOString()
  };
}

async function startBrainControl(
  token: string
): Promise<{ baseUrl: string; close(): Promise<void> }> {
  process.env.JARVIS_PLUGIN_ROOT = fileURLToPath(new URL("../../../plugins", import.meta.url));
  const { createBrainControlServer } = await import("@second-brain/brain-control");
  const server = await createBrainControlServer({
    env: process.env,
    agentCatalog: INITIAL_AGENT_CATALOG,
    pluginCatalog: { get: () => undefined, list: () => [] },
    workerCollaborationToken: token,
    runAuthorizationSecret: "integration-run-authorization-secret-0001",
    effectiveRunPolicies: {
      resolve: async (input) =>
        integrationPolicy(input.workspaceId, input.agentId, input.delegatedToolPolicy),
      resolveIfActive: async (input) =>
        integrationPolicy(input.workspaceId, input.agentId, input.delegatedToolPolicy)
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Expected TCP control server.");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      await once(server, "close");
    }
  };
}

function integrationPolicy(
  workspaceId: string,
  agentId: string,
  delegatedToolPolicy?: readonly string[]
): EffectiveRunPolicyV2 {
  const agent = INITIAL_AGENT_CATALOG.require(agentId);
  const allowed = delegatedToolPolicy ? new Set(delegatedToolPolicy) : undefined;
  const toolIds = [...agent.toolPolicy].filter((tool) => !allowed || allowed.has(tool)).sort();
  return {
    schemaVersion: 2,
    catalogDigest: INITIAL_AGENT_CATALOG.digest,
    policyDigest: `sha256:${"b".repeat(64)}`,
    platformPolicyDigest: `sha256:${"c".repeat(64)}`,
    resourceDigest: `sha256:${"d".repeat(64)}`,
    runtimeImageId: INITIAL_AGENT_CATALOG.runtimeClass(agentId).image,
    workspaceId,
    agentId,
    pluginIds: ["core"],
    capabilityIds: [],
    toolIds,
    skillPaths: [],
    extensionPaths: []
  };
}
