import { describe, expect, it, vi } from "vitest";

import { handleWorkerCollaborationRoute } from "./routes/worker-collaboration-routes.js";

const catalogDigest = `sha256:${"a".repeat(64)}`;
const targetRun = {
  schemaVersion: 1 as const,
  id: "run-browser",
  workspaceId: "workspace-1",
  agentId: "browser" as const,
  catalogVersion: "1.0.0",
  catalogDigest,
  status: "queued" as const,
  rootRunId: "run-browser",
  deadlineAt: "2026-08-28T12:00:00.000Z",
  timeoutSeconds: 60,
  tokenBudget: 1_000,
  createdAt: "2026-08-28T11:00:00.000Z"
};

describe("Brain Control cross-agent control-plane red team", () => {
  it("does not let a worker mutate another agent's run with the shared token", async () => {
    const updateRun = vi.fn().mockResolvedValue({ ...targetRun, status: "running" });
    const writes: Array<{ status: number; body: unknown }> = [];

    await handleWorkerCollaborationRoute(
      {
        method: "PUT",
        headers: { authorization: "Bearer shared-worker-token" }
      } as never,
      {} as never,
      new URL("http://brain-control.local/v1/internal/agent-collaboration/runs/run-browser"),
      {
        runs: { updateRun } as never,
        leases: {} as never,
        token: "shared-worker-token",
        readJson: async () => ({
          ...targetRun,
          status: "running",
          startedAt: "2026-08-28T11:01:00.000Z"
        }),
        writeJson: (_response, status, body) => writes.push({ status, body })
      }
    );

    // The shared worker token opens only the collaboration API. Mutations also
    // require a short-lived capability bound to this exact run identity.
    expect(updateRun).not.toHaveBeenCalled();
    expect(writes).toContainEqual({
      status: 403,
      body: { error: "agent_run_forbidden" }
    });
  });
});
