import { describe, expect, it, vi } from "vitest";

import { handleBrokerRoute } from "./broker-routes.js";
import { RunAuthorizationService } from "../authorization/run-authorization.js";

const secret = Buffer.alloc(32, 0x62).toString("utf8");

describe("broker routes", () => {
  it("publishes a dedicated prompt before returning a pending proposal", async () => {
    const authorizations = new RunAuthorizationService(secret);
    const token = authorizations.issue({
      jobId: "job-one",
      runId: "run-one",
      workspaceId: "workspace-one",
      agentId: "sample-agent",
      catalogDigest: `sha256:${"a".repeat(64)}`,
      executionIdentities: [identity("sample-agent", ["sample_push"])],
      leaseOwner: "worker-one",
      allowedTools: ["sample_push"],
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    const pending = pendingResult();
    const publish = vi.fn();
    const writeJson = vi.fn();

    await handleBrokerRoute(request(token), {} as never, url(), {
      operations: {
        resolve: () => ({ operation: { toolName: "sample_push" } }),
        request: vi.fn().mockResolvedValue(pending)
      } as never,
      runAuthorizations: authorizations,
      approvalPrompts: { publish },
      readJson: async () => ({
        pluginId: "sample-repository",
        operationId: "sample-push",
        agentId: "sample-agent",
        idempotencyKey: "call-one",
        parameters: {}
      }),
      writeJson
    });

    expect(publish).toHaveBeenCalledWith(pending.proposal);
    expect(writeJson).toHaveBeenCalledWith(expect.anything(), 202, pending);
  });

  it("derives required tool authority from the immutable registry", async () => {
    const authorizations = new RunAuthorizationService(secret);
    const token = authorizations.issue({
      jobId: "job-one",
      runId: "run-one",
      workspaceId: "workspace-one",
      agentId: "sample-agent",
      catalogDigest: `sha256:${"a".repeat(64)}`,
      executionIdentities: [identity("sample-agent", ["sample_status"])],
      leaseOwner: "worker-one",
      allowedTools: ["sample_status"],
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    const requestOperation = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      outcome: "consumed",
      result: { summary: "clean" }
    });
    const writes: unknown[] = [];

    await handleBrokerRoute(request(token), {} as never, url(), {
      operations: {
        resolve: () => ({ operation: { toolName: "sample_status" } }),
        request: requestOperation
      } as never,
      runAuthorizations: authorizations,
      approvalPrompts: { publish: vi.fn() },
      readJson: async () => ({
        pluginId: "sample-repository",
        operationId: "sample-status",
        agentId: "sample-agent",
        idempotencyKey: "call-one",
        parameters: {}
      }),
      writeJson: (_response, status, body) => writes.push({ status, body })
    });

    expect(requestOperation).toHaveBeenCalledWith({
      workspaceId: "workspace-one",
      agentId: "sample-agent",
      runId: "run-one",
      pluginId: "sample-repository",
      operationId: "sample-status",
      idempotencyKey: "call-one",
      expiresAt: expect.any(String),
      parameters: {}
    });
    expect(writes).toEqual([{ status: 200, body: { summary: "clean" } }]);
  });

  it("rejects an unavailable operation before invoking a provider", async () => {
    const writeJson = vi.fn();
    await handleBrokerRoute(request("opaque"), {} as never, url(), {
      operations: {
        resolve: () => {
          throw new Error("missing");
        }
      } as never,
      runAuthorizations: new RunAuthorizationService(secret),
      approvalPrompts: { publish: vi.fn() },
      readJson: async () => ({
        pluginId: "removed-plugin",
        operationId: "removed-operation",
        agentId: "sample-agent",
        idempotencyKey: "call-one",
        parameters: {}
      }),
      writeJson
    });
    expect(writeJson).toHaveBeenCalledWith(expect.anything(), 404, {
      error: "broker_operation_unavailable"
    });
  });
});

function request(token: string) {
  return {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "x-jarvis-workspace-id": "workspace-one"
    }
  } as never;
}

function url() {
  return new URL("http://brain-control.local/v1/broker/execute");
}

function identity(agentId: string, allowedTools: string[]) {
  return {
    agentId,
    allowedTools,
    effectivePolicyDigest: `sha256:${"b".repeat(64)}`,
    platformPolicyDigest: `sha256:${"c".repeat(64)}`,
    resourceDigest: `sha256:${"d".repeat(64)}`,
    runtimeImageId: `sha256:${"e".repeat(64)}`
  };
}

function pendingResult() {
  return {
    schemaVersion: 1 as const,
    outcome: "pending" as const,
    proposal: {
      schemaVersion: 1 as const,
      id: "proposal-one",
      operationDigest: `sha256:${"b".repeat(64)}`,
      workspaceId: "workspace-one",
      agentId: "sample-agent",
      runId: "run-one",
      pluginId: "sample-repository",
      capabilityId: "sample-mutation",
      operationId: "sample-push",
      operationVersion: "1.0.0",
      summary: "Push main",
      parameters: {},
      approvalMode: "owner" as const,
      requiredApprover: "owner" as const,
      idempotencyKey: "call-one",
      status: "proposed" as const,
      createdAt: "2026-09-11T10:00:00.000Z",
      expiresAt: "2026-09-12T10:00:00.000Z"
    }
  };
}
