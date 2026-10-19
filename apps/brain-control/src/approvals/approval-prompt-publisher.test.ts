import { describe, expect, it, vi } from "vitest";
import type { OutboundMessageV1 } from "@second-brain/contracts";

import { ApprovalPromptPublisher } from "./approval-prompt-publisher.js";

describe("ApprovalPromptPublisher", () => {
  it("publishes one dedicated prompt in the originating Matrix thread and binds it", async () => {
    const create = vi.fn(async (message: OutboundMessageV1) => message);
    const bindPrompt = vi.fn();
    const publisher = new ApprovalPromptPublisher({
      jobs: {
        snapshot: async () => [
          {
            id: "job-1",
            type: "process_inbound",
            payload: { inboundMessageId: "inbound-1" }
          }
        ]
      } as never,
      inbound: {
        get: async () => ({
          workspaceId: "workspace-1",
          traceId: "trace-1",
          conversationId: "!room",
          externalEventId: "$question",
          threadRootExternalEventId: "$thread"
        })
      } as never,
      outbounds: { create, getByIdempotencyKey: vi.fn() } as never,
      ids: { nextId: () => "outbound-prompt-1" },
      proposals: { bindPrompt }
    });

    await publisher.publish(proposal());

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "outbound-prompt-1",
        replyToExternalEventId: "$thread",
        threadRootExternalEventId: "$thread",
        idempotencyKey: "action-proposal:proposal-1:prompt",
        text: [
          "**Jarvis · Approval required**",
          "",
          "Push main",
          "",
          "@sample-agent · expires in 24 hours",
          "Reply to **this message**: `/yes` approve · `/no` reject"
        ].join("\n")
      })
    );
    expect(bindPrompt).toHaveBeenCalledWith({
      proposalId: "proposal-1",
      workspaceId: "workspace-1",
      outboundMessageId: "outbound-prompt-1"
    });
  });

  it("walks delegated run ancestry to the originating inbound job", async () => {
    const getRun = vi.fn(async (id: string) =>
      id === "child-run" ? { parentRunId: "job-1" } : { id: "job-1" }
    );
    const publisher = new ApprovalPromptPublisher({
      jobs: {
        snapshot: async () => [
          { id: "job-1", type: "process_inbound", payload: { inboundMessageId: "inbound-1" } }
        ]
      } as never,
      inbound: {
        get: async () => ({
          workspaceId: "workspace-1",
          traceId: "trace-1",
          conversationId: "!room",
          externalEventId: "$question"
        })
      } as never,
      outbounds: {
        create: vi.fn(async (message: OutboundMessageV1) => message),
        getByIdempotencyKey: vi.fn()
      } as never,
      ids: { nextId: () => "outbound-prompt-1" },
      proposals: { bindPrompt: vi.fn() },
      runs: { getRun } as never
    });

    await publisher.publish({ ...proposal(), runId: "child-run" });

    expect(getRun).toHaveBeenCalledWith("child-run");
    expect(getRun).toHaveBeenCalledWith("job-1");
  });

  it("publishes a room-level prompt for an approval requested by a schedule", async () => {
    const create = vi.fn(async (message: OutboundMessageV1) => message);
    const publisher = new ApprovalPromptPublisher({
      jobs: {
        snapshot: async () => [
          {
            id: "job-1",
            type: "run_schedule",
            payload: { scheduleId: "schedule-1", executionId: "execution-1" }
          }
        ]
      } as never,
      inbound: { get: vi.fn() },
      outbounds: { create, getByIdempotencyKey: vi.fn() } as never,
      ids: { nextId: () => "outbound-prompt-1" },
      proposals: { bindPrompt: vi.fn() },
      schedules: {
        get: async () => ({
          workspaceId: "workspace-1",
          destinationConversationId: "!scheduled-room"
        })
      } as never
    });

    await publisher.publish(proposal());

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: "schedule:execution-1",
        conversationId: "!scheduled-room"
      })
    );
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("threadRootExternalEventId");
  });
});

function proposal() {
  return {
    schemaVersion: 1 as const,
    id: "proposal-1",
    operationDigest: `sha256:${"a".repeat(64)}`,
    workspaceId: "workspace-1",
    agentId: "sample-agent",
    runId: "job-1",
    pluginId: "sample-repository",
    capabilityId: "git-mutation",
    operationId: "sample-push",
    operationVersion: "1.0.0",
    summary: "Push main",
    parameters: {},
    approvalMode: "owner" as const,
    requiredApprover: "owner" as const,
    idempotencyKey: "push-1",
    status: "proposed" as const,
    createdAt: "2026-09-11T10:00:00.000Z",
    expiresAt: "2026-09-12T10:00:00.000Z"
  };
}
