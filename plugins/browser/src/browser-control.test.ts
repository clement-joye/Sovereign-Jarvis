import { describe, expect, it, vi } from "vitest";

import { BrowserActionService } from "./browser-control.js";

const operation = {
  capabilityId: "browser-mutation",
  operationId: "browser-click",
  operationVersion: "1.0.0",
  approvalPolicy: { minimumMode: "owner" as const, userMayStrengthen: true as const }
};

describe("BrowserActionService", () => {
  it("creates an owner proposal without executing the browser action", async () => {
    const execute = vi.fn();
    const createProposal = vi.fn(async (input: Record<string, unknown>) => ({
      ...input,
      id: "proposal-1",
      capabilityId: operation.capabilityId,
      operationId: operation.operationId,
      operationVersion: operation.operationVersion,
      requiredApprover: "owner",
      status: "proposed",
      createdAt: "2026-09-04T12:00:00.000Z"
    }));
    const service = new BrowserActionService(
      { execute },
      { createProposal } as never,
      { require: () => ({ pluginId: "browser", operation }) } as never
    );

    await expect(
      service.requestOperation({
        workspaceId: "workspace-1",
        agentId: "browser",
        runId: "run-1",
        pluginId: "browser",
        operationId: "browser-click",
        idempotencyKey: "tool-call-1",
        expiresAt: "2026-09-04T12:05:00.000Z",
        parameters: { selector: "#save" }
      })
    ).resolves.toMatchObject({
      outcome: "pending",
      proposal: { status: "proposed", approvalMode: "owner" }
    });
    expect(createProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: "browser",
        agentId: "browser",
        parameters: { selector: "#save" },
        approvalMode: "owner"
      })
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes only a consumed Browser proposal and revalidates its parameters", async () => {
    const execute = vi.fn().mockResolvedValue({ acted: true });
    const service = new BrowserActionService({ execute }, {} as never, {} as never);
    const proposal = {
      schemaVersion: 1,
      id: "proposal-1",
      operationDigest: `sha256:${"a".repeat(64)}`,
      workspaceId: "workspace-1",
      agentId: "browser",
      runId: "run-1",
      pluginId: "browser",
      capabilityId: "browser-mutation",
      operationId: "browser-type",
      operationVersion: "1.0.0",
      summary: "Type",
      parameters: { selector: "#name", text: "Jarvis" },
      approvalMode: "owner",
      requiredApprover: "owner",
      idempotencyKey: "tool-call-1",
      status: "consumed",
      createdAt: "2026-09-04T12:00:00.000Z",
      expiresAt: "2026-09-04T12:05:00.000Z"
    } as const;

    await expect(service.executeApproved(proposal)).resolves.toEqual({ acted: true });
    expect(execute).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      operation: "browser-type",
      parameters: { selector: "#name", text: "Jarvis" }
    });
    await expect(service.executeApproved({ ...proposal, status: "approved" })).rejects.toThrow(
      "requires a consumed"
    );
    await expect(
      service.executeApproved({
        ...proposal,
        parameters: { selector: "#secret", text: "x".repeat(4001) }
      })
    ).rejects.toThrow("input text is invalid");
  });

  it("rejects other agents before creating a proposal", async () => {
    const createProposal = vi.fn();
    const service = new BrowserActionService(
      { execute: vi.fn() },
      { createProposal } as never,
      {} as never
    );
    await expect(
      service.requestOperation({
        workspaceId: "workspace-1",
        agentId: "brain",
        runId: "run-1",
        pluginId: "browser",
        operationId: "browser-click",
        idempotencyKey: "tool-call-1",
        expiresAt: "2026-09-04T12:05:00.000Z",
        parameters: { selector: "button" }
      })
    ).rejects.toThrow("only to the Browser agent");
    expect(createProposal).not.toHaveBeenCalled();
  });
});
