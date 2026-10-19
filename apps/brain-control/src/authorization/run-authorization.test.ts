import { describe, expect, it } from "vitest";

import type { SecurityEventV1 } from "@second-brain/observability";

import { RunAuthorizationService } from "./run-authorization.js";

const secret = Buffer.alloc(32, 0x61).toString("utf8");
const digest = `sha256:${"a".repeat(64)}`;

describe("RunAuthorizationService", () => {
  it("binds an unforgeable token to one run, workspace, agent, and tool ceiling", () => {
    const service = subject();
    const token = service.issue(claims());

    expect(
      service.verify(token, {
        runId: "run-1",
        workspaceId: "workspace-1",
        agentId: "fixture-agent",
        requiredTool: "workspace_write"
      })
    ).toMatchObject({ runId: "run-1", allowedTools: ["workspace_read", "workspace_write"] });
    expect(service.verify(token, { runId: "run-2", workspaceId: "workspace-1" })).toBeUndefined();
    expect(
      service.verify(token, {
        runId: "run-1",
        workspaceId: "workspace-2"
      })
    ).toBeUndefined();
    expect(
      service.verify(token, {
        runId: "run-1",
        workspaceId: "workspace-1",
        agentId: "browser"
      })
    ).toBeUndefined();
    expect(
      service.verify(token, {
        runId: "run-1",
        workspaceId: "workspace-1",
        requiredTool: "schedule_create"
      })
    ).toBeUndefined();
  });

  it("rejects tampering, expiry, and unsafe signing keys", () => {
    const service = subject();
    const token = service.issue(claims());
    const [body, signature] = token.split(".");
    const tampered = `${body?.slice(0, -1)}A.${signature}`;

    expect(
      service.verify(tampered, { runId: "run-1", workspaceId: "workspace-1" })
    ).toBeUndefined();
    const expiredVerifier = new RunAuthorizationService(
      secret,
      () => new Date("2026-08-29T10:02:00.000Z")
    );
    expect(
      expiredVerifier.verify(token, { runId: "run-1", workspaceId: "workspace-1" })
    ).toBeUndefined();
    expect(() => new RunAuthorizationService("too-short")).toThrow("at least 32 bytes");
  });

  it("requires immutable execution identities and accepts pinned bare or named images", () => {
    const service = subject();
    const base = claims();

    expect(() => service.issue({ ...base, executionIdentities: [] })).toThrow(
      "Invalid run authorization executionIdentities."
    );
    expect(() => service.issue({ ...base, executionIdentities: [{} as never] })).toThrow(
      "Invalid run authorization execution identity agentId."
    );
    expect(
      service.issue({
        ...base,
        executionIdentities: [
          {
            ...base.executionIdentities[0]!,
            runtimeImageId: `jarvis/runtime@sha256:${"b".repeat(64)}`
          }
        ]
      })
    ).toContain(".");
    expect(() =>
      service.issue({
        ...base,
        executionIdentities: [
          { ...base.executionIdentities[0]!, runtimeImageId: "jarvis/runtime:latest" }
        ]
      })
    ).toThrow("Invalid run authorization execution identity runtimeImageId.");
  });

  it("requires an exact agent-scoped execution identity when one is expected", () => {
    const service = subject();
    const { agentId: _agentId, ...routerClaims } = claims();
    const token = service.issue({
      ...routerClaims,
      executionIdentities: [
        claims().executionIdentities[0]!,
        {
          agentId: "browser",
          allowedTools: ["websearch"],
          effectivePolicyDigest: `sha256:${"f".repeat(64)}`,
          platformPolicyDigest: `sha256:${"c".repeat(64)}`,
          resourceDigest: `sha256:${"d".repeat(64)}`,
          runtimeImageId: `jarvis/browser@sha256:${"e".repeat(64)}`
        }
      ]
    });

    expect(
      service.verify(token, {
        agentId: "browser",
        effectivePolicyDigest: `sha256:${"f".repeat(64)}`,
        runtimeImageId: `jarvis/browser@sha256:${"e".repeat(64)}`
      })
    ).toBeDefined();
    expect(
      service.verify(token, {
        agentId: "browser",
        effectivePolicyDigest: `sha256:${"a".repeat(64)}`
      })
    ).toBeUndefined();
    expect(
      service.verify(token, { agentId: "browser", requiredTool: "workspace_write" })
    ).toBeUndefined();
  });

  it("emits a bounded denial event without including the bearer token", () => {
    const events: SecurityEventV1[] = [];
    const service = new RunAuthorizationService(
      secret,
      () => new Date("2026-08-29T10:00:00.000Z"),
      { emit: (event) => events.push(event) }
    );

    expect(
      service.verify("not-a-token", { runId: "run-1", workspaceId: "workspace-1" })
    ).toBeUndefined();
    expect(events).toMatchObject([
      {
        type: "authorization.denied",
        reason: "token_malformed",
        runId: "run-1",
        workspaceId: "workspace-1"
      }
    ]);
    expect(JSON.stringify(events)).not.toContain("not-a-token");
  });
});

function subject(): RunAuthorizationService {
  return new RunAuthorizationService(secret, () => new Date("2026-08-29T10:00:00.000Z"));
}

function claims() {
  return {
    jobId: "job-1",
    runId: "run-1",
    workspaceId: "workspace-1",
    agentId: "fixture-agent",
    catalogDigest: digest,
    executionIdentities: [
      {
        agentId: "fixture-agent",
        allowedTools: ["workspace_read", "workspace_write"],
        effectivePolicyDigest: `sha256:${"b".repeat(64)}`,
        platformPolicyDigest: `sha256:${"c".repeat(64)}`,
        resourceDigest: `sha256:${"d".repeat(64)}`,
        runtimeImageId: `sha256:${"e".repeat(64)}`
      }
    ],
    leaseOwner: "worker-1",
    allowedTools: ["workspace_read", "workspace_write"],
    expiresAt: "2026-08-29T10:01:00.000Z"
  };
}
