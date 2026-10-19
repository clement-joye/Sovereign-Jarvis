import { describe, expect, it, vi } from "vitest";
import type { ActionProposalConsumedV1, ActionProposalV1 } from "@second-brain/contracts";

import { ApprovalExecutionRegistry } from "./approval-execution-registry.js";

describe("ApprovalExecutionRegistry", () => {
  it("resumes from durable parameters and consumes before invoking the provider", async () => {
    const proposal = makeProposal();
    const order: string[] = [];
    const proposals = {
      getProposal: vi.fn().mockResolvedValue(proposal),
      consumeAndExecute: vi.fn(
        async (
          _binding: unknown,
          execute: (proposal: ActionProposalV1) => Promise<unknown>
        ): Promise<ActionProposalConsumedV1> => {
          order.push("consumed");
          return {
            schemaVersion: 1 as const,
            proposalId: proposal.id,
            outcome: "consumed" as const,
            result: await execute(proposal)
          };
        }
      )
    };
    const registry = new ApprovalExecutionRegistry(proposals);
    registry.register({
      pluginId: "example-plugin",
      operationId: "publish",
      execute: async (stored) => {
        order.push("executed");
        return stored.parameters;
      }
    });

    await expect(registry.executeApproved(proposal.id)).resolves.toMatchObject({
      outcome: "consumed",
      result: { target: "reviewed" }
    });
    expect(order).toEqual(["consumed", "executed"]);
    expect(proposals.consumeAndExecute).toHaveBeenCalledWith(
      expect.objectContaining({ operationDigest: proposal.operationDigest }),
      expect.any(Function)
    );
  });

  it("does not consume a proposal without a registered provider", async () => {
    const proposals = {
      getProposal: vi.fn().mockResolvedValue(makeProposal()),
      consumeAndExecute: vi.fn()
    };
    const registry = new ApprovalExecutionRegistry(proposals);
    await expect(registry.executeApproved("proposal-1")).rejects.toThrow(/No approved action/);
    expect(proposals.consumeAndExecute).not.toHaveBeenCalled();
  });
});

function makeProposal(): ActionProposalV1 {
  return {
    schemaVersion: 1,
    id: "proposal-1",
    operationDigest: `sha256:${"a".repeat(64)}`,
    workspaceId: "workspace-1",
    agentId: "fixture-agent",
    runId: "run-1",
    pluginId: "example-plugin",
    capabilityId: "publishing",
    operationId: "publish",
    operationVersion: "1.0.0",
    summary: "Publish reviewed content",
    parameters: { target: "reviewed" },
    approvalMode: "owner",
    requiredApprover: "owner",
    idempotencyKey: "publish-1",
    status: "approved",
    createdAt: "2026-08-29T12:00:00.000Z",
    expiresAt: "2026-08-29T12:05:00.000Z"
  };
}
