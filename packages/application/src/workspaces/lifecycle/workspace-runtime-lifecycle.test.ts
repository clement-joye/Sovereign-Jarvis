import { describe, expect, it, vi } from "vitest";
import type { WorkspaceRecord } from "@second-brain/domain";
import { WorkspaceRuntimeLifecycleService } from "./workspace-runtime-lifecycle.js";

describe("WorkspaceRuntimeLifecycleService", () => {
  it("activates only after a ready runtime and archives by cancelling it first", async () => {
    let workspace: WorkspaceRecord = record();
    const cancel = vi.fn();
    const archive = vi.fn();
    const service = new WorkspaceRuntimeLifecycleService(
      { get: async () => workspace, update: async (next) => (workspace = next) },
      {
        provision: async () => ({
          workspaceId: "workspace-1",
          templateId: "second-brain",
          templateVersion: "1.0.0",
          health: "ready"
        }),
        run: async () => {
          throw new Error("not used");
        },
        cancel,
        archive,
        resolve: async () => undefined,
        health: async () => "ready",
        destroy: async () => undefined
      },
      { now: () => new Date("2026-08-04T12:00:00.000Z") }
    );
    await expect(service.provision("workspace-1")).resolves.toMatchObject({ status: "active" });
    await expect(service.archive("workspace-1")).resolves.toMatchObject({ status: "archived" });
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(archive.mock.invocationCallOrder[0]!);
  });

  it("records failed provisioning before surfacing the runtime error", async () => {
    let workspace: WorkspaceRecord = record();
    const service = new WorkspaceRuntimeLifecycleService(
      { get: async () => workspace, update: async (next) => (workspace = next) },
      {
        provision: async () => {
          throw new Error("runtime unavailable");
        },
        run: async () => {
          throw new Error("not used");
        },
        cancel: async () => undefined,
        archive: async () => undefined,
        resolve: async () => undefined,
        health: async () => "unprovisioned",
        destroy: async () => undefined
      },
      { now: () => new Date("2026-08-04T12:00:00.000Z") }
    );
    await expect(service.provision("workspace-1")).rejects.toThrow("runtime unavailable");
    expect(workspace.status).toBe("failed");
  });

  it("only reprovisions active workspaces whose runtime is unhealthy", async () => {
    let workspace: WorkspaceRecord = { ...record(), status: "active" };
    const provision = vi.fn().mockResolvedValue({
      workspaceId: "workspace-1",
      templateId: "second-brain",
      templateVersion: "1.0.0",
      health: "ready"
    });
    const health = vi.fn().mockResolvedValue("unhealthy");
    const service = new WorkspaceRuntimeLifecycleService(
      { get: async () => workspace, update: async (next) => (workspace = next) },
      {
        provision,
        health,
        run: async () => {
          throw new Error("not used");
        },
        cancel: async () => undefined,
        archive: async () => undefined,
        resolve: async () => undefined,
        destroy: async () => undefined
      },
      { now: () => new Date() }
    );
    await expect(service.recover("workspace-1")).resolves.toMatchObject({ status: "active" });
    expect(provision).toHaveBeenCalledOnce();
  });

  it("leaves an active workspace alone when its runtime is already ready", async () => {
    let workspace: WorkspaceRecord = { ...record(), status: "active" };
    const provision = vi.fn();
    const service = new WorkspaceRuntimeLifecycleService(
      { get: async () => workspace, update: async (next) => (workspace = next) },
      {
        provision,
        health: async () => "ready",
        run: async () => {
          throw new Error("not used");
        },
        cancel: async () => undefined,
        archive: async () => undefined,
        resolve: async () => undefined,
        destroy: async () => undefined
      },
      { now: () => new Date() }
    );

    await expect(service.recover("workspace-1")).resolves.toBe(workspace);
    expect(provision).not.toHaveBeenCalled();
  });
});
function record(): WorkspaceRecord {
  const now = new Date();
  return {
    id: "workspace-1",
    templateId: "second-brain",
    templateVersion: "1.0.0",
    configuration: {},
    status: "provisioning",
    origin: "matrix_invite",
    createdAt: now,
    updatedAt: now
  };
}
