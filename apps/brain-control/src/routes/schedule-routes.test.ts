import { describe, expect, it, vi } from "vitest";

import { handleScheduleRoute } from "./schedule-routes.js";
import { RunAuthorizationService } from "../authorization/run-authorization.js";

describe("schedule routes", () => {
  it("does not claim non-schedule requests when schedule authentication is configured", async () => {
    await expect(
      handleScheduleRoute(
        { method: "POST", headers: {} } as never,
        {} as never,
        new URL("http://brain-control.local/v1/sessions/bind"),
        {
          scheduleService: {} as never,
          ids: { nextId: () => "id" },
          scheduleToken: "schedule-token",
          readJson: async () => ({}),
          writeJson: vi.fn()
        }
      )
    ).resolves.toBe(false);
  });

  it("allows unscoped scheduler requests when Pi schedule authentication is configured", async () => {
    const claimDue = vi.fn().mockResolvedValue([]);
    const writes: Array<{ status: number; body: unknown }> = [];

    await expect(
      handleScheduleRoute(
        { method: "POST", headers: {} } as never,
        {} as never,
        new URL("http://brain-control.local/v1/schedules/claim-due"),
        {
          scheduleService: { claimDue } as never,
          ids: { nextId: () => "id" },
          scheduleToken: "schedule-token",
          readJson: async () => ({}),
          writeJson: (_response, status, body) => writes.push({ status, body })
        }
      )
    ).resolves.toBe(true);

    expect(claimDue).toHaveBeenCalledWith(10);
    expect(writes).toEqual([{ status: 200, body: [] }]);
  });

  it("persists the authenticated workspace and requested room when creating a schedule", async () => {
    const create = vi.fn().mockResolvedValue({ created: true });
    const writes: Array<{ status: number; body: unknown }> = [];

    await expect(
      handleScheduleRoute(
        {
          method: "POST",
          headers: {
            authorization: "Bearer schedule-token",
            "x-jarvis-workspace-id": "workspace-room"
          }
        } as never,
        {} as never,
        new URL("http://brain-control.local/v1/schedules"),
        {
          scheduleService: { create } as never,
          ids: { nextId: () => "id" },
          scheduleToken: "schedule-token",
          readJson: async () => ({
            destinationConversationId: "room-example",
            agentId: "browser",
            name: "Room review",
            instruction: "Summarize the room.",
            schedule: { type: "once", runAt: "2026-08-16T09:00:00.000Z" }
          }),
          writeJson: (_response, status, body) => writes.push({ status, body })
        }
      )
    ).resolves.toBe(true);

    expect(create).toHaveBeenCalledWith({
      workspaceId: "workspace-room",
      destinationConversationId: "room-example",
      agentId: "browser",
      name: "Room review",
      instruction: "Summarize the room.",
      schedule: { type: "once", runAt: "2026-08-16T09:00:00.000Z" }
    });
    expect(writes).toEqual([{ status: 201, body: { created: true } }]);
  });

  it("turns a run-authorized mutation into a durable proposal without executing it", async () => {
    const create = vi.fn();
    const propose = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      outcome: "pending",
      proposal: { id: "action-proposal-1" }
    });
    const writes: Array<{ status: number; body: unknown }> = [];
    const runAuthorizations = new RunAuthorizationService(
      "schedule-route-test-secret-with-at-least-32-bytes",
      () => new Date("2026-08-29T12:00:00.000Z")
    );
    const token = runAuthorizations.issue({
      jobId: "job-1",
      runId: "run-1",
      workspaceId: "workspace-1",
      agentId: "planner",
      catalogDigest: `sha256:${"a".repeat(64)}`,
      executionIdentities: [
        {
          agentId: "planner",
          allowedTools: ["schedule_create"],
          effectivePolicyDigest: `sha256:${"b".repeat(64)}`,
          platformPolicyDigest: `sha256:${"c".repeat(64)}`,
          resourceDigest: `sha256:${"d".repeat(64)}`,
          runtimeImageId: `sha256:${"e".repeat(64)}`
        }
      ],
      leaseOwner: "worker-1",
      allowedTools: ["schedule_create"],
      expiresAt: "2026-08-29T12:05:00.000Z"
    });

    await handleScheduleRoute(
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "x-jarvis-workspace-id": "workspace-1",
          "x-jarvis-idempotency-key": "tool-call-1"
        }
      } as never,
      {} as never,
      new URL("http://brain-control.local/v1/schedules"),
      {
        scheduleService: { create } as never,
        scheduleApprovals: { propose } as never,
        runAuthorizations,
        ids: { nextId: () => "id" },
        readJson: async () => ({
          name: "Daily review",
          instruction: "Review today's notes.",
          schedule: { type: "cron", expression: "0 18 * * *", timezone: "Europe/Stockholm" }
        }),
        writeJson: (_response, status, body) => writes.push({ status, body })
      }
    );

    expect(create).not.toHaveBeenCalled();
    expect(propose).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        agentId: "planner",
        runId: "run-1",
        idempotencyKey: "tool-call-1",
        operation: "schedule-create"
      })
    );
    expect(writes).toEqual([
      {
        status: 202,
        body: {
          schemaVersion: 1,
          outcome: "pending",
          proposal: { id: "action-proposal-1" }
        }
      }
    ]);
  });
});
