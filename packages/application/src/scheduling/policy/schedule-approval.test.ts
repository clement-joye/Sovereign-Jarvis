import { describe, expect, it, vi } from "vitest";
import type { ActionProposalCreateRequestV1 } from "@second-brain/contracts";

import { ScheduleApprovalService } from "./schedule-approval.js";

describe("ScheduleApprovalService", () => {
  it("creates an owner proposal without mutating the schedule", async () => {
    const schedules = scheduleServiceFake();
    const createProposal = vi
      .fn()
      .mockImplementation(async (input: ActionProposalCreateRequestV1) => ({
        ...input,
        id: "action-proposal-1",
        capabilityId: input.operation.capabilityId,
        operationId: input.operation.operationId,
        operationVersion: input.operation.operationVersion,
        requiredApprover: "owner",
        status: "proposed",
        createdAt: "2026-08-29T12:00:00.000Z"
      }));
    const service = new ScheduleApprovalService(schedules as never, { createProposal } as never);

    const result = await service.propose({
      workspaceId: "workspace-1",
      agentId: "planner",
      runId: "run-1",
      idempotencyKey: "tool-call-1",
      expiresAt: "2026-08-29T12:05:00.000Z",
      operation: "schedule-create",
      parameters: {
        request: {
          destinationConversationId: "!room:example",
          destinationThreadRootExternalEventId: "$thread:example",
          name: "Daily review",
          instruction: "Review today's notes.",
          schedule: { type: "cron", expression: "0 18 * * *", timezone: "Europe/Stockholm" }
        }
      }
    });

    expect(result).toMatchObject({
      outcome: "pending",
      proposal: {
        pluginId: "schedule-control",
        operationId: "schedule-create",
        approvalMode: "owner",
        idempotencyKey: "tool-call-1"
      }
    });
    expect(schedules.create).not.toHaveBeenCalled();
    expect(createProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: {
          request: expect.objectContaining({
            destinationThreadRootExternalEventId: "$thread:example"
          })
        }
      })
    );
  });

  it("applies the approved thread destination to the created schedule", async () => {
    const schedules = scheduleServiceFake();
    const service = new ScheduleApprovalService(schedules as never, {} as never);

    await service.executeApproved({
      schemaVersion: 1,
      id: "action-proposal-1",
      operationDigest: `sha256:${"a".repeat(64)}`,
      workspaceId: "workspace-1",
      agentId: "scheduler",
      runId: "run-1",
      pluginId: "schedule-control",
      capabilityId: "schedule-mutation",
      operationId: "schedule-create",
      operationVersion: "1.0.0",
      summary: "Create schedule Say hi",
      parameters: {
        request: {
          destinationConversationId: "!room:example",
          destinationThreadRootExternalEventId: "$thread:example",
          name: "Say hi",
          instruction: "say hi",
          schedule: { type: "once", runAt: "2026-10-14T08:22:43Z" }
        }
      },
      approvalMode: "owner",
      requiredApprover: "owner",
      idempotencyKey: "call-1",
      status: "consumed",
      createdAt: "2026-10-14T08:17:00Z",
      expiresAt: "2026-10-14T08:27:00Z"
    });

    expect(schedules.create).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationConversationId: "!room:example",
        destinationThreadRootExternalEventId: "$thread:example"
      })
    );
  });

  it("executes only the exact consumed schedule proposal", async () => {
    const schedules = scheduleServiceFake();
    const service = new ScheduleApprovalService(schedules as never, {} as never);
    const proposal = {
      schemaVersion: 1 as const,
      id: "action-proposal-1",
      operationDigest: `sha256:${"a".repeat(64)}`,
      workspaceId: "workspace-1",
      agentId: "planner" as const,
      runId: "run-1",
      pluginId: "schedule-control",
      capabilityId: "schedule-mutation",
      operationId: "schedule-delete",
      operationVersion: "1.0.0",
      summary: "Delete schedule Daily review",
      parameters: { id: "schedule-1", request: { expectedVersion: 2 } },
      approvalMode: "owner" as const,
      requiredApprover: "owner" as const,
      idempotencyKey: "tool-call-1",
      status: "consumed" as const,
      createdAt: "2026-08-29T12:00:00.000Z",
      expiresAt: "2026-08-29T12:05:00.000Z"
    };

    await expect(service.executeApproved(proposal)).resolves.toEqual({ id: "schedule-1" });
    expect(schedules.delete).toHaveBeenCalledWith("schedule-1", 2);
    await expect(service.executeApproved({ ...proposal, status: "approved" })).rejects.toThrow(
      /consumed/i
    );
  });

  it("rejects a cross-workspace target before proposing", async () => {
    const schedules = scheduleServiceFake();
    const createProposal = vi.fn();
    const service = new ScheduleApprovalService(schedules as never, { createProposal } as never);

    await expect(
      service.propose({
        workspaceId: "workspace-other",
        agentId: "planner",
        runId: "run-1",
        idempotencyKey: "tool-call-1",
        expiresAt: "2026-08-29T12:05:00.000Z",
        operation: "schedule-delete",
        parameters: { id: "schedule-1", request: { expectedVersion: 2 } }
      })
    ).rejects.toThrow(/authorized workspace/i);
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("rejects a schedule without a destination before sending an approval request", async () => {
    const createProposal = vi.fn();
    const service = new ScheduleApprovalService(
      scheduleServiceFake() as never,
      {
        createProposal
      } as never
    );

    await expect(
      service.propose({
        workspaceId: "workspace-1",
        agentId: "scheduler",
        runId: "run-1",
        idempotencyKey: "tool-call-1",
        expiresAt: "2026-08-29T12:05:00.000Z",
        operation: "schedule-create",
        parameters: {
          request: {
            name: "Say hi",
            instruction: "say hi",
            schedule: { type: "once", runAt: "2026-08-29T12:05:00Z" }
          }
        }
      })
    ).rejects.toThrow("Schedule creation requires a destination conversation.");
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("uses the compiled operation identity and floor when a registry is supplied", async () => {
    const createProposal = vi
      .fn()
      .mockImplementation(async (input: ActionProposalCreateRequestV1) => ({
        ...input,
        id: "action-proposal-1",
        capabilityId: input.operation.capabilityId,
        operationId: input.operation.operationId,
        operationVersion: input.operation.operationVersion,
        requiredApprover: "owner",
        status: "proposed",
        createdAt: "2026-08-29T12:00:00.000Z"
      }));
    const service = new ScheduleApprovalService(
      scheduleServiceFake() as never,
      { createProposal } as never,
      {
        require: () => ({
          pluginId: "core",
          operation: {
            capabilityId: "schedule-mutation",
            operationId: "schedule-create",
            operationVersion: "1.0.0",
            approvalPolicy: { minimumMode: "owner", userMayStrengthen: true }
          }
        })
      }
    );

    await service.propose({
      workspaceId: "workspace-1",
      agentId: "scheduler",
      runId: "run-1",
      idempotencyKey: "tool-call-1",
      expiresAt: "2026-08-29T12:05:00.000Z",
      operation: "schedule-create",
      parameters: {
        request: {
          destinationConversationId: "!room:example",
          name: "Daily review",
          instruction: "Review today's notes.",
          schedule: { type: "cron", expression: "0 18 * * *", timezone: "Europe/Stockholm" }
        }
      }
    });

    expect(createProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: "core",
        operation: expect.objectContaining({ capabilityId: "schedule-mutation" })
      })
    );
  });
});

function scheduleServiceFake() {
  return {
    get: vi.fn().mockResolvedValue({
      id: "schedule-1",
      workspaceId: "workspace-1",
      name: "Daily review"
    }),
    create: vi.fn().mockResolvedValue({ created: true }),
    update: vi.fn().mockResolvedValue({ updated: true }),
    delete: vi.fn().mockResolvedValue({ id: "schedule-1" }),
    runNow: vi.fn().mockResolvedValue({ id: "execution-1" })
  };
}
