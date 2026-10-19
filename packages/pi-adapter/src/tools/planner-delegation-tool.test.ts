import { describe, expect, it, vi } from "vitest";

import {
  createPlannerDelegationStatusTool,
  createPlannerDelegationTool
} from "./planner-delegation-tool.js";
import { PlannerDelegationSpecV1Schema } from "@second-brain/contracts";

const delegationPolicy = {
  mayDelegateTo: ["brain", "browser"],
  toolPolicyByAgent: {
    brain: [],
    browser: ["websearch", "browser_navigate", "browser_extract"]
  },
  maxChildren: 1
};

describe("planner delegation tool", () => {
  it("submits the parent and complete structured child proposal durably", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "child-1",
            status: "completed",
            resultText: "My mission is concise."
          }),
          { status: 201 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    const tool = createPlannerDelegationTool({
      baseUrl: "http://control.test",
      token: "delegation-token",
      delegationPolicy,
      parent: {
        schemaVersion: 1,
        id: "parent-1",
        workspaceId: "workspace-1",
        agentId: "planner",
        catalogVersion: "1.0.0",
        catalogDigest: `sha256:${"a".repeat(64)}`,
        status: "running",
        rootRunId: "parent-1",
        deadlineAt: "2026-08-18T21:00:00.000Z",
        timeoutSeconds: 300,
        tokenBudget: 45_000,
        createdAt: "2026-08-18T20:00:00.000Z"
      }
    });

    const result = await tool.execute(
      "call-1",
      {
        targetAgentId: "brain",
        task: "State your mission in one sentence."
      },
      new AbortController().signal,
      () => undefined,
      {} as never
    );

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/v1/planner-delegations", "http://control.test"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer delegation-token" })
      })
    );
    const request = (fetchMock.mock.calls as unknown as Array<[URL, RequestInit]>)[0]?.[1];
    if (!request) throw new Error("Expected delegation request.");
    if (typeof request.body !== "string")
      throw new Error("Expected a JSON delegation request body.");
    const body = JSON.parse(request.body) as { spec: unknown };
    const parsed = PlannerDelegationSpecV1Schema.safeParse(body.spec);
    expect(parsed.success).toBe(true);
    expect(body.spec).toEqual({
      targetAgentId: "brain",
      task: "State your mission in one sentence.",
      allowedTools: [],
      readablePaths: [],
      writablePaths: []
    });
    expect(result.content).toEqual([
      {
        type: "text",
        text: JSON.stringify({
          id: "child-1",
          status: "completed",
          resultText: "My mission is concise."
        })
      }
    ]);
    vi.unstubAllGlobals();
  });

  it("advertises reviewed target-specific tool grants", () => {
    const tool = createPlannerDelegationTool({
      baseUrl: "http://control.test",
      token: "delegation-token",
      delegationPolicy,
      parent: {
        schemaVersion: 1,
        id: "parent-1",
        workspaceId: "workspace-1",
        agentId: "planner",
        catalogVersion: "1.0.0",
        catalogDigest: `sha256:${"a".repeat(64)}`,
        status: "running",
        rootRunId: "parent-1",
        deadlineAt: "2026-08-18T21:00:00.000Z",
        timeoutSeconds: 300,
        tokenBudget: 45_000,
        createdAt: "2026-08-18T20:00:00.000Z"
      }
    });

    expect(tool.description).toContain("browser=[websearch, browser_navigate, browser_extract]");
    expect(tool.description).toContain("allowedTools contains tool IDs, never agent role IDs");
    const properties = (tool.parameters as { properties: Record<string, unknown> }).properties;
    expect(properties).not.toHaveProperty("timeoutSeconds");
    expect(properties).not.toHaveProperty("tokenBudget");
    expect(properties).not.toHaveProperty("expectedArtifact");
    expect(properties).not.toHaveProperty("confirmationBoundary");
  });

  it("rejects role names used as tool IDs before calling Brain Control", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const tool = createPlannerDelegationTool({
      baseUrl: "http://control.test",
      token: "delegation-token",
      delegationPolicy,
      parent: {
        schemaVersion: 1,
        id: "parent-1",
        workspaceId: "workspace-1",
        agentId: "planner",
        catalogVersion: "1.0.0",
        catalogDigest: `sha256:${"a".repeat(64)}`,
        status: "running",
        rootRunId: "parent-1",
        deadlineAt: "2026-08-18T21:00:00.000Z",
        timeoutSeconds: 300,
        tokenBudget: 45_000,
        createdAt: "2026-08-18T20:00:00.000Z"
      }
    });

    await expect(
      tool.execute(
        "call-1",
        {
          targetAgentId: "browser",
          task: "Fetch Stockholm weather.",
          allowedTools: ["browser"],
          readablePaths: [],
          writablePaths: []
        },
        new AbortController().signal,
        () => undefined,
        {} as never
      )
    ).rejects.toThrow(
      'Invalid allowedTools for agent "browser": browser. Valid reviewed tool IDs: websearch, browser_navigate, browser_extract.'
    );
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("reads persisted child statuses and artifacts without creating another child", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify([{ run: { id: "child-1" }, artifacts: [] }]))
    );
    vi.stubGlobal("fetch", fetchMock);
    const tool = createPlannerDelegationStatusTool({
      baseUrl: "http://control.test",
      token: "delegation-token",
      parentRunId: "parent-1"
    });

    await tool.execute("call-1", {}, new AbortController().signal, () => undefined, {} as never);

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/v1/agent-runs/parent-1/children", "http://control.test"),
      expect.objectContaining({ headers: { authorization: "Bearer delegation-token" } })
    );
    vi.unstubAllGlobals();
  });

  it("surfaces a timed-out child as a usable Planner tool error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "planner_delegation_timeout" }), { status: 504 })
      )
    );
    const tool = createPlannerDelegationTool({
      baseUrl: "http://control.test",
      token: "delegation-token",
      delegationPolicy,
      parent: {
        schemaVersion: 1,
        id: "parent-1",
        workspaceId: "workspace-1",
        agentId: "planner",
        catalogVersion: "1.0.0",
        catalogDigest: `sha256:${"a".repeat(64)}`,
        status: "running",
        rootRunId: "parent-1",
        deadlineAt: "2026-08-18T21:00:00.000Z",
        timeoutSeconds: 300,
        tokenBudget: 45_000,
        createdAt: "2026-08-18T20:00:00.000Z"
      }
    });

    await expect(
      tool.execute(
        "call-1",
        {
          targetAgentId: "brain",
          task: "State your mission.",
          allowedTools: [],
          readablePaths: [],
          writablePaths: []
        },
        new AbortController().signal,
        () => undefined,
        {} as never
      )
    ).rejects.toThrow("planner_delegation_timeout");
    vi.unstubAllGlobals();
  });
});
