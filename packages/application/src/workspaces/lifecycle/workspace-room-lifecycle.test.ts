import { describe, expect, it, vi } from "vitest";

import { WorkspaceRoomLifecycleService } from "./workspace-room-lifecycle.js";

describe("WorkspaceRoomLifecycleService", () => {
  it("archives a bound workspace and safely accepts a replay", async () => {
    let workspace = {
      id: "workspace-1",
      templateId: "second-brain",
      templateVersion: "1.0.0",
      configuration: {},
      status: "active" as const,
      origin: "matrix_invite" as const,
      createdAt: new Date("2026-08-04T10:00:00.000Z"),
      updatedAt: new Date("2026-08-04T10:00:00.000Z")
    };
    const cancel = vi.fn();
    const archive = vi.fn();
    const disableByWorkspace = vi.fn().mockResolvedValue(1);
    const service = new WorkspaceRoomLifecycleService(
      {
        getByRoomId: async (roomId) => (roomId === "!room:example" ? workspace : undefined),
        update: async (next) => {
          workspace = next as typeof workspace;
          return next;
        }
      },
      { now: () => new Date("2026-08-04T11:00:00.000Z") },
      { cancel, archive },
      { disableByWorkspace }
    );

    await expect(service.archiveRoom("!room:example")).resolves.toMatchObject({
      status: "archived",
      archivedAt: new Date("2026-08-04T11:00:00.000Z")
    });
    await expect(service.archiveRoom("!room:example")).resolves.toMatchObject({
      status: "archived"
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(archive).toHaveBeenCalledOnce();
    expect(disableByWorkspace).toHaveBeenCalledOnce();
    expect(disableByWorkspace).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      now: new Date("2026-08-04T11:00:00.000Z")
    });
  });
});
