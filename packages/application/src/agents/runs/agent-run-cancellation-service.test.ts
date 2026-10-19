import { describe, expect, it, vi } from "vitest";
import type { AgentRunV1 } from "@second-brain/contracts";

import { AgentRunCancellationService } from "./agent-run-cancellation-service.js";
import { AgentRunCancellationFinalizer } from "./agent-run-cancellation-finalizer.js";

function record(id: string, status: AgentRunV1["status"], parentRunId?: string): AgentRunV1 {
  return {
    schemaVersion: 1,
    id,
    workspaceId: "workspace-1",
    agentId: "planner",
    catalogVersion: "1.0.0",
    catalogDigest: `sha256:${"a".repeat(64)}`,
    status,
    rootRunId: parentRunId ?? id,
    ...(parentRunId ? { parentRunId } : {}),
    deadlineAt: "2026-08-18T21:00:00.000Z",
    timeoutSeconds: 60,
    tokenBudget: 100,
    createdAt: "2026-08-18T20:00:00.000Z"
  };
}

describe("AgentRunCancellationService", () => {
  it("cancels descendants before the active parent and signals both runtimes", async () => {
    const values = new Map([
      ["parent", record("parent", "running")],
      ["child", record("child", "running", "parent")]
    ]);
    const updateRun = vi.fn(async (value: AgentRunV1) => {
      values.set(value.id, value);
      return value;
    });
    const cancel = vi.fn(async (_runId: string) => undefined);
    const cancelForRun = vi.fn().mockResolvedValue([]);
    const cancelRootRun = vi.fn().mockResolvedValue(2);
    const subject = new AgentRunCancellationService(
      {
        getRun: async (id) => values.get(id),
        listChildren: async (id) => (id === "parent" ? [values.get("child")!] : []),
        updateRun
      },
      { cancel: async (run) => cancel(run.id) },
      { now: () => new Date("2026-08-18T20:01:00.000Z") },
      new AgentRunCancellationFinalizer(
        { now: () => new Date("2026-08-18T20:01:00.000Z") },
        { cancelForRun },
        { cancelRootRun }
      )
    );

    await subject.cancel("parent");

    expect(updateRun.mock.calls.map(([value]) => value.id)).toEqual(["child", "parent"]);
    expect(cancel.mock.calls).toEqual([["child"], ["parent"]]);
    const cancelForRunCalls = cancelForRun.mock.calls as Array<[{ runId: string }]>;
    expect(cancelForRunCalls.map(([value]) => value.runId)).toEqual(["child", "parent"]);
    expect(values.get("parent")?.status).toBe("cancelled");
    expect(cancelRootRun).toHaveBeenCalledWith(
      expect.objectContaining({ rootRunId: "parent", reason: "agent_tree_cancelled" })
    );
  });

  it("retains active state and admission when a runtime has not confirmed cancellation", async () => {
    const run = record("parent", "running");
    const updateRun = vi.fn();
    const cancelRootRun = vi.fn();
    const subject = new AgentRunCancellationService(
      {
        getRun: async () => run,
        listChildren: async () => [],
        updateRun
      },
      { cancel: async () => Promise.reject(new Error("runtime unavailable")) },
      { now: () => new Date("2026-08-18T20:01:00.000Z") },
      new AgentRunCancellationFinalizer(
        { now: () => new Date("2026-08-18T20:01:00.000Z") },
        undefined,
        { cancelRootRun }
      )
    );

    await expect(subject.cancel("parent")).rejects.toThrow("runtime unavailable");
    expect(updateRun).not.toHaveBeenCalled();
    expect(cancelRootRun).not.toHaveBeenCalled();
  });
});
