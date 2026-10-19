import { describe, expect, it } from "vitest";

import type { ActionProposalV1, ScheduledJobV1 } from "@second-brain/contracts";

import { approvedActionResult } from "./approved-action-result.js";

describe("approvedActionResult", () => {
  it("confirms a created schedule without exposing internal records", () => {
    const result = approvedActionResult(proposal("schedule-create"), {
      schedule: schedule(),
      preview: {
        nextRunAt: "2026-10-13T08:20:08.000Z",
        occurrences: ["2026-10-13T08:20:08.000Z"]
      }
    });

    expect(result).toBe(
      "**Schedule created**\n\nSay Hi Task · @brain\nNext run: 2026-10-13 08:20 UTC"
    );
    expect(result).not.toMatch(/workspaceId|destinationConversationId|sessionPolicy|schedule-1/u);
  });

  it("shows a paused schedule after an approved update", () => {
    expect(
      approvedActionResult(proposal("schedule-update"), {
        schedule: { ...schedule(), enabled: false, nextRunAt: undefined },
        preview: { occurrences: [] }
      })
    ).toBe("**Schedule updated**\n\nSay Hi Task · @brain\nPaused");
  });

  it("confirms deletion and immediate runs without dumping their records", () => {
    expect(approvedActionResult(proposal("schedule-delete"), schedule())).toBe(
      "**Schedule deleted**\n\nSay Hi Task"
    );
    expect(
      approvedActionResult(proposal("schedule-run-now"), {
        schemaVersion: 1,
        id: "execution-1",
        scheduleId: "schedule-1",
        scheduledFor: "2026-10-13T08:20:08.000Z",
        status: "queued",
        attempt: 0,
        createdAt: "2026-10-13T08:20:08.000Z"
      })
    ).toBe("**Schedule run queued**\n\nRun schedule Say Hi Task now");
  });

  it("uses the approved summary if an unexpected schedule result is returned", () => {
    expect(approvedActionResult(proposal("schedule-create"), { internal: "private" })).toBe(
      "**Approved action completed**\n\nCreate schedule Say Hi Task"
    );
  });

  it("keeps plain results while omitting structured data from other approvals", () => {
    const other = {
      ...proposal("sample-push"),
      pluginId: "sample-repository",
      summary: "Push main"
    };
    expect(approvedActionResult(other, "Pushed")).toBe(
      "**Approved action completed**\n\nPush main\n\nPushed"
    );
    expect(approvedActionResult(other, { summary: "Pushed", internalId: "record-1" })).toBe(
      "**Approved action completed**\n\nPush main\n\nPushed"
    );
    expect(approvedActionResult(other, { internalId: "record-1" })).toBe(
      "**Approved action completed**\n\nPush main"
    );
  });
});

function proposal(operationId: string): ActionProposalV1 {
  return {
    schemaVersion: 1,
    id: "proposal-1",
    operationDigest: `sha256:${"a".repeat(64)}`,
    workspaceId: "workspace-1",
    agentId: "scheduler",
    runId: "run-1",
    pluginId: "schedule-control",
    capabilityId: "schedule-mutation",
    operationId,
    operationVersion: "1.0.0",
    summary:
      operationId === "schedule-run-now"
        ? "Run schedule Say Hi Task now"
        : "Create schedule Say Hi Task",
    parameters: {},
    approvalMode: "owner",
    requiredApprover: "owner",
    idempotencyKey: "test-key-1",
    status: "approved",
    createdAt: "2026-10-13T08:18:32.246Z",
    expiresAt: "2026-10-14T08:18:32.246Z"
  };
}

function schedule(): ScheduledJobV1 {
  return {
    schemaVersion: 1,
    id: "schedule-1",
    workspaceId: "workspace-1",
    destinationConversationId: "!room",
    agentId: "brain",
    name: "Say Hi Task",
    instruction: "say hi",
    schedule: { type: "once", runAt: "2026-10-13T08:20:08+00:00" },
    enabled: true,
    sessionPolicy: { type: "fresh" },
    notificationPolicy: "always",
    overlapPolicy: "skip",
    missedRunPolicy: "run_once",
    timeoutSeconds: 600,
    nextRunAt: "2026-10-13T08:20:08.000Z",
    version: 1,
    createdAt: "2026-10-13T08:18:32.246Z",
    updatedAt: "2026-10-13T08:18:32.246Z"
  };
}
