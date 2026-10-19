import { describe, expect, it, vi } from "vitest";

import { ApprovalCommandHandler } from "./approval-command-handler.js";
import { ApprovedActionExecutionError } from "../registries/approval-execution-registry.js";
import { ActionProposalConflictError, ActionProposalExpiredError } from "./approval-service.js";

describe("ApprovalCommandHandler", () => {
  it("forwards trusted Matrix identity and executes an approval", async () => {
    const decide = vi.fn().mockResolvedValue({ id: "proposal-1", summary: "Push main" });
    const executeApproved = vi.fn().mockResolvedValue({ result: { summary: "Pushed" } });
    const handler = new ApprovalCommandHandler(
      proposalCommands(decide),
      { executeApproved },
      { now: () => new Date("2026-08-29T12:00:00.000Z") }
    );

    await expect(
      handler.handle(message(), { type: "approve", proposalId: "proposal-1" })
    ).resolves.toBe("**Approved action completed**\n\nPush main\n\nPushed");
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        ownerId: "@owner:example.test",
        externalEventId: "$approval"
      })
    );
    expect(executeApproved).toHaveBeenCalledWith("proposal-1");
  });

  it("never executes a rejection", async () => {
    const executeApproved = vi.fn();
    const handler = new ApprovalCommandHandler(
      proposalCommands(vi.fn().mockResolvedValue({ id: "proposal-1" })),
      { executeApproved },
      { now: () => new Date() }
    );
    await expect(
      handler.handle(message(), { type: "reject", proposalId: "proposal-1" })
    ).resolves.toMatch(/rejected/);
    expect(executeApproved).not.toHaveBeenCalled();
  });

  it("approves only the proposal bound to the replied-to approval prompt", async () => {
    const decide = vi.fn().mockResolvedValue({ id: "proposal-2", summary: "Push main" });
    const getProposalForPromptReply = vi.fn().mockResolvedValue({ id: "proposal-2" });
    const handler = new ApprovalCommandHandler(
      { decide, getProposalForPromptReply },
      { executeApproved: vi.fn().mockResolvedValue({ result: "Pushed" }) },
      { now: () => new Date("2026-08-29T12:00:00.000Z") }
    );

    await handler.handle(
      { ...message(), text: "/yes", replyToExternalEventId: "$approval-prompt" },
      { type: "approve-reply" }
    );

    expect(getProposalForPromptReply).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      externalEventId: "$approval-prompt"
    });
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ proposalId: "proposal-2" }));
  });

  it("rejects contextual decisions that are not replies to approval prompts", async () => {
    const decide = vi.fn();
    const handler = new ApprovalCommandHandler(
      { decide, getProposalForPromptReply: vi.fn() },
      { executeApproved: vi.fn() },
      { now: () => new Date() }
    );

    await expect(handler.handle(message(), { type: "approve-reply" })).resolves.toContain(
      "Reply directly"
    );
    expect(decide).not.toHaveBeenCalled();
  });

  it("explains how to reply when the target is another message in the thread", async () => {
    const decide = vi.fn();
    const handler = new ApprovalCommandHandler(
      { decide, getProposalForPromptReply: vi.fn().mockResolvedValue(undefined) },
      { executeApproved: vi.fn() },
      { now: () => new Date() }
    );

    await expect(
      handler.handle(
        { ...message(), text: "/yes", replyToExternalEventId: "$agent-follow-up" },
        { type: "approve-reply" }
      )
    ).resolves.toContain("Use Reply on the **Jarvis · Approval required** message itself");
    expect(decide).not.toHaveBeenCalled();
  });

  it("does not automatically replay an ambiguous failed execution", async () => {
    const executeApproved = vi.fn().mockRejectedValue(new Error("network outcome unknown"));
    const handler = new ApprovalCommandHandler(
      proposalCommands(vi.fn().mockResolvedValue({ id: "proposal-1", summary: "Publish" })),
      { executeApproved },
      { now: () => new Date() }
    );
    await expect(
      handler.handle(message(), { type: "approve", proposalId: "proposal-1" })
    ).resolves.toMatch(/will not retry/);
    expect(executeApproved).toHaveBeenCalledOnce();
  });

  it("reports execution failures and presents only provider-vetted reasons", async () => {
    const reportExecutionFailure = vi.fn();
    const failure = new ApprovedActionExecutionError(
      "Git clone helper request failed: Clone directory already exists"
    );
    const handler = new ApprovalCommandHandler(
      proposalCommands(
        vi.fn().mockResolvedValue({
          id: "proposal-1",
          summary: "Clone repository",
          workspaceId: "workspace-1",
          pluginId: "sample-repository",
          operationId: "sample-clone"
        })
      ),
      { executeApproved: vi.fn().mockRejectedValue(failure) },
      { now: () => new Date() },
      reportExecutionFailure
    );

    const response = await handler.handle(message(), {
      type: "approve",
      proposalId: "proposal-1"
    });

    expect(response).toContain("Clone directory already exists");
    expect(response).toContain("proposal-1");
    expect(reportExecutionFailure).toHaveBeenCalledWith(
      expect.objectContaining({ error: failure, operationId: "sample-clone" })
    );
  });

  it("returns an actionable terminal response for an expired proposal", async () => {
    const executeApproved = vi.fn();
    const handler = new ApprovalCommandHandler(
      proposalCommands(vi.fn().mockRejectedValue(new ActionProposalExpiredError("expired"))),
      { executeApproved },
      { now: () => new Date() }
    );

    await expect(
      handler.handle(message(), { type: "approve", proposalId: "proposal-1" })
    ).resolves.toContain("Submit the original request again");
    expect(executeApproved).not.toHaveBeenCalled();
  });

  it("returns a terminal response for an unavailable or already-decided proposal", async () => {
    const handler = new ApprovalCommandHandler(
      proposalCommands(vi.fn().mockRejectedValue(new ActionProposalConflictError("not found"))),
      { executeApproved: vi.fn() },
      { now: () => new Date() }
    );

    await expect(
      handler.handle(message(), { type: "reject", proposalId: "proposal-1" })
    ).resolves.toContain("Approval not applied");
  });

  it("still propagates unexpected persistence failures for worker retry", async () => {
    const handler = new ApprovalCommandHandler(
      proposalCommands(vi.fn().mockRejectedValue(new Error("database unavailable"))),
      { executeApproved: vi.fn() },
      { now: () => new Date() }
    );

    await expect(
      handler.handle(message(), { type: "approve", proposalId: "proposal-1" })
    ).rejects.toThrow("database unavailable");
  });
});

function proposalCommands(decide: ReturnType<typeof vi.fn>) {
  return { decide, getProposalForPromptReply: vi.fn() };
}

function message() {
  return {
    schemaVersion: 1 as const,
    id: "inbound-approval",
    traceId: "trace-approval",
    transport: "matrix" as const,
    externalEventId: "$approval",
    conversationId: "!room:example.test",
    workspaceId: "workspace-1",
    senderId: "@owner:example.test",
    receivedAt: "2026-08-29T12:00:00.000Z",
    kind: "command" as const,
    text: "/approve proposal-1",
    attachments: [],
    metadata: {}
  };
}
