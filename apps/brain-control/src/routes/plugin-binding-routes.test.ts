import { describe, expect, it, vi } from "vitest";

import { handlePluginBindingRoute } from "./plugin-binding-routes.js";

const manifest = {
  id: "calendar",
  contentDigest: `sha256:${"a".repeat(64)}`,
  operations: [
    { id: "create-event", toolName: "create_event", approvalPolicy: "none" as const },
    { id: "list-events", toolName: "list_events", approvalPolicy: "none" as const }
  ],
  agentIds: ["planner"],
  activation: "workspace" as const,
  configurationSchema: {},
  skills: [],
  extensions: []
};

const manifestWithOwnerFloor = {
  ...manifest,
  operations: [
    { id: "create-event", toolName: "create_event", approvalPolicy: "owner" as const },
    { id: "list-events", toolName: "list_events", approvalPolicy: "none" as const }
  ]
};

function setup(policyModes: Record<string, "none" | "owner"> = {}) {
  const writes: Array<{ status: number; body: unknown }> = [];
  const approvalPolicies = {
    getMode: vi.fn(
      async (_workspace: string, _plugin: string, operation: string) =>
        policyModes[operation] ?? "none"
    ),
    replaceOwnerRequiredOperations: vi.fn().mockResolvedValue(undefined)
  };
  const dependencies = {
    bindings: { get: vi.fn(), upsert: vi.fn(), disable: vi.fn() },
    catalog: { get: vi.fn().mockReturnValue(manifest) },
    approvalPolicies,
    adminToken: "admin-secret",
    readJson: vi.fn(),
    writeJson: (_response: unknown, status: number, body: unknown) => writes.push({ status, body }),
    now: () => new Date()
  };
  return { dependencies, writes };
}

function setupWithManifest(
  manifestValue: unknown,
  policyModes: Record<string, "none" | "owner"> = {}
) {
  const result = setup(policyModes);
  result.dependencies.catalog.get.mockReturnValue(manifestValue);
  return result;
}

describe("plugin approval policy routes", () => {
  it("does not expose built-in agent bundles as workspace bindings", async () => {
    const { dependencies, writes } = setupWithManifest({
      ...manifest,
      activation: "built-in"
    });

    await handlePluginBindingRoute(
      { method: "GET", headers: { authorization: "Bearer admin-secret" } } as never,
      {} as never,
      new URL("http://control.test/v1/workspaces/ws-1/plugins/core-agents"),
      dependencies
    );

    expect(writes).toEqual([{ status: 409, body: { error: "built_in_plugin_binding_forbidden" } }]);
    expect(dependencies.bindings.get).not.toHaveBeenCalled();
  });

  it("returns the effective owner-required operations using hyphenated tool IDs", async () => {
    const { dependencies, writes } = setup({ "create-event": "owner" });

    await handlePluginBindingRoute(
      { method: "GET", headers: { authorization: "Bearer admin-secret" } } as never,
      {} as never,
      new URL("http://control.test/v1/workspaces/ws-1/plugins/calendar/approval-policy"),
      dependencies
    );

    expect(writes).toEqual([{ status: 200, body: { ownerRequiredOperations: ["create-event"] } }]);
    expect(dependencies.approvalPolicies.getMode).toHaveBeenCalledWith(
      "ws-1",
      "calendar",
      "create-event"
    );
  });

  it("atomically replaces the user policy and permits clearing it", async () => {
    const { dependencies, writes } = setup();
    dependencies.readJson.mockResolvedValue({ ownerRequiredOperations: [] });

    await handlePluginBindingRoute(
      { method: "PUT", headers: { authorization: "Bearer admin-secret" } } as never,
      {} as never,
      new URL("http://control.test/v1/workspaces/ws-1/plugins/calendar/approval-policy"),
      dependencies
    );

    expect(dependencies.approvalPolicies.replaceOwnerRequiredOperations).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      pluginId: "calendar",
      operationIds: [],
      updatedAt: expect.any(Date)
    });
    expect(writes).toEqual([{ status: 204, body: undefined }]);
  });

  it("keeps manifest owner floors in GET and stores only user additions on PUT", async () => {
    const { dependencies, writes } = setupWithManifest(manifestWithOwnerFloor);
    dependencies.readJson.mockResolvedValue({
      ownerRequiredOperations: ["create-event", "list-events"]
    });

    await handlePluginBindingRoute(
      { method: "PUT", headers: { authorization: "Bearer admin-secret" } } as never,
      {} as never,
      new URL("http://control.test/v1/workspaces/ws-1/plugins/calendar/approval-policy"),
      dependencies
    );
    expect(dependencies.approvalPolicies.replaceOwnerRequiredOperations).toHaveBeenCalledWith(
      expect.objectContaining({ operationIds: ["list-events"] })
    );

    dependencies.approvalPolicies.getMode.mockResolvedValue("none");
    await handlePluginBindingRoute(
      { method: "GET", headers: { authorization: "Bearer admin-secret" } } as never,
      {} as never,
      new URL("http://control.test/v1/workspaces/ws-1/plugins/calendar/approval-policy"),
      dependencies
    );
    expect(writes.at(-1)).toEqual({
      status: 200,
      body: { ownerRequiredOperations: ["create-event"] }
    });
  });

  it("rejects unknown and duplicate operations without weakening manifest policy", async () => {
    const { dependencies, writes } = setup();
    dependencies.readJson.mockResolvedValue({ ownerRequiredOperations: ["unknown"] });

    await handlePluginBindingRoute(
      { method: "PUT", headers: { authorization: "Bearer admin-secret" } } as never,
      {} as never,
      new URL("http://control.test/v1/workspaces/ws-1/plugins/calendar/approval-policy"),
      dependencies
    );
    dependencies.readJson.mockResolvedValue({
      ownerRequiredOperations: ["create-event", "create-event"]
    });
    await handlePluginBindingRoute(
      { method: "PUT", headers: { authorization: "Bearer admin-secret" } } as never,
      {} as never,
      new URL("http://control.test/v1/workspaces/ws-1/plugins/calendar/approval-policy"),
      dependencies
    );

    expect(writes).toEqual([
      { status: 400, body: { error: "invalid_approval_policy" } },
      { status: 400, body: { error: "invalid_approval_policy" } }
    ]);
    expect(dependencies.approvalPolicies.replaceOwnerRequiredOperations).not.toHaveBeenCalled();
  });

  it("requires the admin token", async () => {
    const { dependencies, writes } = setup();
    await handlePluginBindingRoute(
      { method: "GET", headers: {} } as never,
      {} as never,
      new URL("http://control.test/v1/workspaces/ws-1/plugins/calendar/approval-policy"),
      dependencies
    );
    expect(writes).toEqual([{ status: 401, body: { error: "plugin_admin_unauthorized" } }]);
  });
});

describe("plugin binding routes", () => {
  it("enables a reviewed workspace plugin for eligible agents and persists its configuration", async () => {
    const { dependencies, writes } = setupWithManifest({
      ...manifest,
      configurationSchema: { calendarId: "string", includeWeekends: "boolean" },
      agentIds: ["planner"]
    });
    dependencies.readJson.mockResolvedValue({
      enabledAgents: ["planner"],
      configuration: { calendarId: "primary", includeWeekends: false }
    });

    await handlePluginBindingRoute(
      { method: "PUT", headers: { authorization: "Bearer admin-secret" } } as never,
      {} as never,
      new URL("http://control.test/v1/workspaces/ws-1/plugins/calendar"),
      dependencies
    );

    expect(dependencies.bindings.upsert).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      pluginId: "calendar",
      pluginVersion: manifest.contentDigest,
      enabledAgents: ["planner"],
      configuration: { calendarId: "primary", includeWeekends: false },
      updatedAt: expect.any(Date)
    });
    expect(writes).toEqual([{ status: 204, body: undefined }]);
  });

  it("rejects a binding that would enable an ineligible agent or omit configuration fields", async () => {
    const { dependencies, writes } = setupWithManifest({
      ...manifest,
      configurationSchema: { calendarId: "string" },
      agentIds: ["planner"]
    });
    dependencies.readJson.mockResolvedValue({
      enabledAgents: ["brain"],
      configuration: {}
    });

    await handlePluginBindingRoute(
      { method: "PUT", headers: { authorization: "Bearer admin-secret" } } as never,
      {} as never,
      new URL("http://control.test/v1/workspaces/ws-1/plugins/calendar"),
      dependencies
    );

    expect(writes).toEqual([{ status: 400, body: { error: "invalid_plugin_binding" } }]);
    expect(dependencies.bindings.upsert).not.toHaveBeenCalled();
  });

  it("idempotently disables a workspace plugin through the authenticated route", async () => {
    const { dependencies, writes } = setup();

    await handlePluginBindingRoute(
      { method: "DELETE", headers: { authorization: "Bearer admin-secret" } } as never,
      {} as never,
      new URL("http://control.test/v1/workspaces/ws-1/plugins/calendar"),
      dependencies
    );

    expect(dependencies.bindings.disable).toHaveBeenCalledWith("ws-1", "calendar");
    expect(writes).toEqual([{ status: 204, body: undefined }]);
  });
});
