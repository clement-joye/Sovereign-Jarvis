import { describe, expect, it, vi } from "vitest";

import { exampleInboundMessage } from "@second-brain/contracts";
import type { WorkspaceRecord } from "@second-brain/domain";

import { RoomLifecycleCommandSubmissionService } from "./room-lifecycle-command.js";
import type { WorkspaceRepositoryPort } from "../ports.js";

describe("RoomLifecycleCommandSubmissionService", () => {
  it("reports active workspace status without invoking Pi", async () => {
    const create = vi.fn().mockResolvedValue({});
    const runtime = {
      health: vi.fn().mockResolvedValue("ready"),
      cancel: vi.fn(),
      archive: vi.fn()
    };
    const service = new RoomLifecycleCommandSubmissionService({
      workspaces: { get: async () => workspace(), update: async (value) => value },
      outbounds: { create },
      ids: { nextId: () => "outbound-1" },
      clock: { now: () => new Date("2026-08-14T12:00:00.000Z") },
      runtime
    });

    await expect(
      service.submit({
        ...exampleInboundMessage,
        workspaceId: "workspace-1",
        text: "/workspace status"
      })
    ).resolves.toMatchObject({ handled: true });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Status: active · runtime: ready.",
        presentation: "notice"
      })
    );
    expect(runtime.cancel).not.toHaveBeenCalled();
  });

  it("archives the room runtime and workspace without template configuration", async () => {
    const update = vi.fn<WorkspaceRepositoryPort["update"]>(async (value) => value);
    const runtime = { health: vi.fn(), cancel: vi.fn(), archive: vi.fn() };
    const disableByWorkspace = vi.fn().mockResolvedValue(2);
    const service = new RoomLifecycleCommandSubmissionService({
      workspaces: { get: async () => workspace(), update },
      outbounds: { create: vi.fn().mockResolvedValue({}) },
      ids: { nextId: () => "outbound-1" },
      clock: { now: () => new Date("2026-08-14T12:00:00.000Z") },
      runtime,
      schedules: { disableByWorkspace }
    });

    await service.submit({
      ...exampleInboundMessage,
      workspaceId: "workspace-1",
      text: "/workspace archive"
    });

    expect(runtime.cancel).toHaveBeenCalledWith("workspace-1");
    expect(runtime.archive).toHaveBeenCalledWith("workspace-1");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: "archived" }));
    expect(disableByWorkspace).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      now: new Date("2026-08-14T12:00:00.000Z")
    });
  });
});

function workspace(): WorkspaceRecord {
  return {
    id: "workspace-1",
    templateId: "second-brain",
    templateVersion: "1.0.0",
    configuration: {},
    status: "active",
    origin: "matrix_invite",
    createdAt: new Date("2026-08-14T11:00:00.000Z"),
    updatedAt: new Date("2026-08-14T11:00:00.000Z")
  };
}
