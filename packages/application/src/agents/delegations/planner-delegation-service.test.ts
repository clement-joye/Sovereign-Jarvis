import { describe, expect, it, vi } from "vitest";
import type { AgentRunV1, PlannerDelegationSpecV1 } from "@second-brain/contracts";
import { INITIAL_AGENT_CATALOG } from "@second-brain/domain";

import { PlannerDelegationService } from "./planner-delegation-service.js";
import { PlannerDelegationGrantFactory } from "./planner-delegation-grant-factory.js";

const parent: AgentRunV1 = {
  schemaVersion: 1,
  id: "orchestrator-run-1",
  workspaceId: "workspace-1",
  agentId: "orchestrator",
  catalogVersion: INITIAL_AGENT_CATALOG.version,
  catalogDigest: INITIAL_AGENT_CATALOG.digest,
  status: "running",
  rootRunId: "orchestrator-run-1",
  deadlineAt: "2026-08-18T21:00:00.000Z",
  timeoutSeconds: 300,
  tokenBudget: 45_000,
  createdAt: "2026-08-18T20:00:00.000Z"
};
const spec: PlannerDelegationSpecV1 = {
  targetAgentId: "document-analyzer",
  task: "Extract key facts from the supplied document.",
  allowedTools: ["workspace_read"],
  readablePaths: ["documents"],
  writablePaths: []
};

describe("PlannerDelegationService", () => {
  it("derives child execution limits from parent and target policy", async () => {
    const createChild = vi.fn(async ({ parent: run }: { parent: AgentRunV1 }) => ({
      ...run,
      id: "child-1"
    }));
    const service = subject(createChild);

    await service.delegate({ parent, spec });

    expect(createChild).toHaveBeenCalledWith(
      expect.objectContaining({
        parent,
        grant: expect.objectContaining({
          childAgentId: "document-analyzer",
          timeoutSeconds: 300,
          tokenBudget: 45_000,
          expiresAt: "2026-08-18T21:00:00.000Z"
        })
      })
    );
  });

  it("caps derived limits by the target policy and live parent deadline", async () => {
    const createChild = vi.fn(async ({ parent: run }: { parent: AgentRunV1 }) => ({
      ...run,
      id: "child-1"
    }));
    const service = subject(createChild);

    await service.delegate({
      parent: {
        ...parent,
        deadlineAt: "2026-08-18T20:00:20.000Z",
        timeoutSeconds: 600,
        tokenBudget: 100_000
      },
      spec
    });

    expect(createChild).toHaveBeenCalledWith(
      expect.objectContaining({
        grant: expect.objectContaining({
          timeoutSeconds: 20,
          tokenBudget: 100_000,
          expiresAt: "2026-08-18T20:00:20.000Z"
        })
      })
    );
  });

  it("rejects a second active child and targets outside Orchestrator's reviewed policy", async () => {
    const child = {
      ...parent,
      id: "child-1",
      agentId: "document-analyzer" as const,
      parentRunId: parent.id
    };
    const createChild = vi.fn();
    const service = subject(createChild, [child]);

    await expect(service.delegate({ parent, spec })).rejects.toThrow(
      "Active child run limit (1) reached."
    );
    await expect(
      service.delegate({ parent, spec: { ...spec, targetAgentId: "orchestrator" } })
    ).rejects.toThrow("not enabled in the reviewed catalog");
  });

  it("allows Orchestrator to delegate to Brain even though root Brain can delegate", async () => {
    const createChild = vi.fn(async ({ parent: run }: { parent: AgentRunV1 }) => ({
      ...run,
      id: "child-1"
    }));

    await subject(createChild).delegate({
      parent,
      spec: { ...spec, targetAgentId: "brain", allowedTools: [], readablePaths: [] }
    });

    expect(createChild).toHaveBeenCalledWith(
      expect.objectContaining({ grant: expect.objectContaining({ childAgentId: "brain" }) })
    );
  });

  it("allows a root Brain run to delegate one scheduler task", async () => {
    const createChild = vi.fn(async ({ parent: run }: { parent: AgentRunV1 }) => ({
      ...run,
      id: "child-1"
    }));

    await subject(createChild).delegate({
      parent: { ...parent, agentId: "brain" },
      spec: {
        targetAgentId: "scheduler",
        task: "List this workspace's schedules.",
        allowedTools: ["schedule_list"],
        readablePaths: [],
        writablePaths: []
      }
    });

    expect(createChild).toHaveBeenCalledWith(
      expect.objectContaining({ grant: expect.objectContaining({ childAgentId: "scheduler" }) })
    );
  });

  it("rejects further delegation from a delegated Brain run", async () => {
    const delegatedBrain = {
      ...parent,
      agentId: "brain",
      parentRunId: parent.id,
      delegationGrantId: "grant-1"
    };
    await expect(subject(vi.fn()).delegate({ parent: delegatedBrain, spec })).rejects.toThrow(
      "Delegated children may not delegate."
    );
  });
});

function subject(
  createChild: ReturnType<typeof vi.fn>,
  children: AgentRunV1[] = []
): PlannerDelegationService {
  return new PlannerDelegationService(
    { listChildren: async () => children, listArtifactsByRun: async () => [] },
    { createChild },
    new PlannerDelegationGrantFactory(
      INITIAL_AGENT_CATALOG,
      { nextId: (prefix) => `${prefix}-1` },
      { now: () => new Date("2026-08-18T20:00:00.000Z") }
    )
  );
}
