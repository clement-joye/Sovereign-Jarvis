import { describe, expect, it, vi } from "vitest";

import { dispatchCliCommand } from "./commands.js";

describe("Brain CLI commands", () => {
  it("uses the status command when no arguments are provided", async () => {
    const request = vi.fn(async () => ({ jobs: 2 }));

    await expect(dispatchCliCommand([], { request })).resolves.toEqual({
      command: "status",
      status: "ok",
      result: { jobs: 2 }
    });
    expect(request).toHaveBeenCalledWith("/v1/admin/status");
  });

  it("builds a deterministic manual schedule-run request", async () => {
    const request = vi.fn(async () => ({ id: "execution-1" }));

    await expect(
      dispatchCliCommand(["schedules", "run", "schedule-1"], { request, now: () => 123 })
    ).resolves.toMatchObject({ command: "schedules run", status: "ok" });
    expect(request).toHaveBeenCalledWith("/v1/schedules/schedule-1/run", {
      method: "POST",
      body: { requestId: "brainctl-123" }
    });
  });

  it("returns usage for an unknown command without making a request", async () => {
    const request = vi.fn(async () => ({}));

    await expect(dispatchCliCommand(["unknown"], { request })).resolves.toMatchObject({
      command: "unknown",
      status: "invalid"
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("lists workspaces through the new /v1/workspaces endpoint", async () => {
    const request = vi.fn(async () => [{ id: "workspace-example", status: "active" }]);

    await expect(dispatchCliCommand(["workspaces", "list"], { request })).resolves.toEqual({
      command: "workspaces list",
      status: "ok",
      result: [{ id: "workspace-example", status: "active" }]
    });
    expect(request).toHaveBeenCalledWith("/v1/workspaces");
  });

  it("forwards a workspace status filter to the control plane", async () => {
    const request = vi.fn(async () => []);

    await expect(
      dispatchCliCommand(["workspaces", "list", "--status=configuring"], { request })
    ).resolves.toMatchObject({ command: "workspaces list", status: "ok" });
    expect(request).toHaveBeenCalledWith("/v1/workspaces?status=configuring");
  });

  it("retrieves a single workspace by its identifier", async () => {
    const request = vi.fn(async () => ({ id: "workspace-x", status: "archived" }));

    await expect(
      dispatchCliCommand(["workspaces", "show", "workspace-x"], { request })
    ).resolves.toMatchObject({
      command: "workspaces show",
      status: "ok",
      result: { id: "workspace-x", status: "archived" }
    });
    expect(request).toHaveBeenCalledWith("/v1/workspaces/workspace-x", undefined);
  });

  it("rejects malformed workspace list invocations with usage information", async () => {
    const request = vi.fn(async () => ({}));

    await expect(
      dispatchCliCommand(["workspaces", "delete", "workspace-x"], { request })
    ).resolves.toMatchObject({ command: "workspaces delete workspace-x", status: "invalid" });
    expect(request).not.toHaveBeenCalled();
  });
});
