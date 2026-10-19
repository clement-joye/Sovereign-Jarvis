import { describe, expect, it, vi } from "vitest";

import type { WorkspaceRecord } from "@second-brain/domain";

import {
  UnknownWorkspaceRoomRuntimeRecoveryError,
  WorkspaceRoomRuntimeRecoveryService
} from "./workspace-room-runtime-recovery.js";

describe("WorkspaceRoomRuntimeRecoveryService", () => {
  it("derives the recovered workspace from its room binding", async () => {
    const recover = vi.fn().mockResolvedValue(workspace());
    const service = new WorkspaceRoomRuntimeRecoveryService(
      { getByRoomId: async () => workspace() },
      { recover }
    );

    await expect(service.recoverRoom("!project:example")).resolves.toMatchObject({
      id: "workspace-1",
      status: "active"
    });
    expect(recover).toHaveBeenCalledWith("workspace-1");
  });

  it("rejects an unbound room without attempting recovery", async () => {
    const recover = vi.fn();
    const service = new WorkspaceRoomRuntimeRecoveryService(
      { getByRoomId: async () => undefined },
      { recover }
    );

    await expect(service.recoverRoom("!unknown:example")).rejects.toBeInstanceOf(
      UnknownWorkspaceRoomRuntimeRecoveryError
    );
    expect(recover).not.toHaveBeenCalled();
  });
});

function workspace(): WorkspaceRecord {
  const now = new Date("2026-08-04T12:00:00.000Z");
  return {
    id: "workspace-1",
    templateId: "code-project",
    templateVersion: "1.0.0",
    configuration: {},
    status: "active",
    origin: "matrix_invite",
    createdAt: now,
    updatedAt: now
  };
}
