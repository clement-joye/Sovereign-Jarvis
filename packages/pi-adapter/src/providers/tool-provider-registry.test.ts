import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CompiledCapabilityProviderV2, PiRunRequestV1 } from "@second-brain/contracts";
import { INITIAL_AGENT_CATALOG } from "@second-brain/domain";
import { describe, expect, it, vi } from "vitest";

import {
  ToolProviderRegistry,
  createDefaultToolProviderRegistry,
  type PiToolProvider,
  type PiToolProviderContext
} from "./tool-provider-registry.js";

describe("ToolProviderRegistry", () => {
  it("materializes only reviewed implementations and filters their tool superset", () => {
    const createWorkspace = vi.fn(() => [tool("workspace_read"), tool("workspace_write")]);
    const createOther = vi.fn(() => [tool("other")]);
    const registry = new ToolProviderRegistry([
      provider("workspace-tools", createWorkspace),
      provider("other-tools", createOther)
    ]);

    const selected = registry.select(
      context(),
      [capability("workspace-read", "workspace-tools", ["workspace_read"])],
      ["workspace_read"]
    );

    expect(selected.implementationIds).toEqual(["workspace-tools"]);
    expect(selected.tools.map(({ name }) => name)).toEqual(["workspace_read"]);
    expect(createWorkspace).toHaveBeenCalledOnce();
    expect(createOther).not.toHaveBeenCalled();
  });

  it("fails explicitly when a reviewed implementation is unavailable", () => {
    const registry = new ToolProviderRegistry([]);
    expect(() =>
      registry.select(
        context(),
        [capability("missing", "missing-provider", ["missing_tool"])],
        ["missing_tool"]
      )
    ).toThrow("No Pi tool provider is registered");
  });

  it("exposes bounded delegation tools to a root Brain run", () => {
    const tools = createDefaultToolProviderRegistry().select(
      context(),
      [
        capability("planner-delegation", "planner-delegation-control", [
          "delegate",
          "delegate_status"
        ])
      ],
      ["delegate", "delegate_status"]
    ).tools;

    expect(tools.map((tool) => tool.name)).toEqual(["delegate", "delegate_status"]);
    expect(JSON.stringify(tools[0]?.parameters)).toContain("scheduler");
    expect(JSON.stringify(tools[0]?.parameters)).not.toContain('"orchestrator"');
  });

  it("rejects duplicate provider IDs and effective tool names", () => {
    expect(
      () =>
        new ToolProviderRegistry([provider("duplicate", () => []), provider("duplicate", () => [])])
    ).toThrow("Duplicate Pi tool provider");

    const registry = new ToolProviderRegistry([
      provider("first", () => [tool("same")]),
      provider("second", () => [tool("same")])
    ]);
    expect(() =>
      registry.select(
        context(),
        [capability("first", "first", ["same"]), capability("second", "second", ["same"])],
        ["same"]
      )
    ).toThrow("same effective tool name");
  });

  it("forwards security events into workspace tools selected from the default registry", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-tool-registry-"));
    try {
      await writeFile(join(root, "private.txt"), "private");
      const events: Array<{ type: string; reason: string; runId?: string }> = [];
      const tools = createDefaultToolProviderRegistry([], {
        securityEvents: { emit: (event) => events.push(event) }
      }).select(
        {
          ...context(),
          workspaceRoot: root,
          request: { ...context().request, readablePaths: [] }
        },
        [capability("workspace-read", "workspace-tools", ["workspace_read"])],
        ["workspace_read"]
      ).tools;
      const read = tools.find((tool) => tool.name === "workspace_read");
      await expect(
        read?.execute("call", { path: "private.txt" }, undefined, undefined, {} as never)
      ).rejects.toThrow("outside delegated");
      expect(events).toEqual([
        expect.objectContaining({
          type: "workspace_path.denied",
          reason: "delegated_scope",
          runId: "run-1"
        })
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses the durable Matrix origin as a delegated schedule destination", async () => {
    const fetchRequest = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("stop", { status: 400 }));
    try {
      const tools = createDefaultToolProviderRegistry().select(
        {
          ...context(),
          request: {
            ...context().request,
            agentId: "scheduler",
            noticeOrigin: {
              conversationId: "!source-room:example",
              replyToExternalEventId: "$event:example",
              threadRootExternalEventId: "$root:example"
            }
          }
        },
        [capability("schedule-mutation", "schedule-control", ["schedule_create"])],
        ["schedule_create"]
      ).tools;
      const create = tools.find((tool) => tool.name === "schedule_create");
      await expect(
        create?.execute(
          "call-1",
          {
            name: "Say hi",
            instruction: "say hi",
            scheduleType: "once",
            runAt: "2026-10-14T08:22:43Z"
          },
          undefined,
          undefined,
          {} as never
        )
      ).rejects.toThrow("Schedule API POST");
      const bodyText = fetchRequest.mock.calls[0]?.[1]?.body;
      if (typeof bodyText !== "string") throw new Error("Expected a schedule request body.");
      const body: unknown = JSON.parse(bodyText);
      expect(body).toMatchObject({
        destinationConversationId: "!source-room:example",
        destinationThreadRootExternalEventId: "$root:example",
        workspaceId: "workspace-1"
      });
    } finally {
      fetchRequest.mockRestore();
    }
  });
});

function provider(implementationId: string, create: PiToolProvider["create"]): PiToolProvider {
  return { implementationId, create };
}

function tool(name: string) {
  return defineTool({
    name,
    label: name,
    description: name,
    parameters: Type.Object({}),
    async execute() {
      return { content: [{ type: "text" as const, text: name }], details: {} };
    }
  });
}

function capability(
  capabilityId: string,
  implementationId: string,
  toolIds: string[]
): CompiledCapabilityProviderV2 {
  return {
    capabilityId,
    pluginId: "core",
    providerId: `${capabilityId}-provider`,
    implementationId,
    definitionDigest: `sha256:${"a".repeat(64)}`,
    providerKind: "local",
    toolIds,
    filesystem: "none",
    process: "none",
    network: "none",
    sideEffect: "none"
  };
}

function context(): PiToolProviderContext {
  const request: PiRunRequestV1 = {
    schemaVersion: 1,
    id: "run-1",
    workspaceId: "workspace-1",
    agentId: "brain",
    traceId: "trace-1",
    sessionId: "session-1",
    inputText: "test",
    images: [],
    sourceReferences: [],
    timeoutSeconds: 60,
    priority: "interactive",
    runAuthorization: "authorization"
  };
  return {
    request,
    workspaceRoot: "/workspace",
    brainControlUrl: "http://brain-control",
    agentCatalog: INITIAL_AGENT_CATALOG,
    scheduleToolEvents: []
  };
}
