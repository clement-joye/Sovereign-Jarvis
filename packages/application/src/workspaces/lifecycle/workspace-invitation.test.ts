import { describe, expect, it } from "vitest";

import type { WorkspaceRecord, WorkspaceRoomBindingRecord } from "@second-brain/domain";

import {
  DEFAULT_ROOM_TEMPLATE_ID,
  DEFAULT_ROOM_TEMPLATE_VERSION,
  WorkspaceInvitationService
} from "./workspace-invitation.js";
import type { WorkspaceRepositoryPort } from "../../ports.js";

class InMemoryWorkspaceRepository implements WorkspaceRepositoryPort {
  private readonly workspaces = new Map<string, WorkspaceRecord>();
  private readonly bindings = new Map<string, WorkspaceRoomBindingRecord>();

  async create(workspace: WorkspaceRecord): Promise<WorkspaceRecord> {
    this.workspaces.set(workspace.id, workspace);
    return workspace;
  }

  async update(workspace: WorkspaceRecord): Promise<WorkspaceRecord> {
    this.workspaces.set(workspace.id, workspace);
    return workspace;
  }

  async get(id: string): Promise<WorkspaceRecord | undefined> {
    return this.workspaces.get(id);
  }

  async list(): Promise<WorkspaceRecord[]> {
    return [...this.workspaces.values()];
  }

  async getByRoomId(roomId: string): Promise<WorkspaceRecord | undefined> {
    const binding = this.bindings.get(roomId);
    return binding ? this.workspaces.get(binding.workspaceId) : undefined;
  }

  async getActiveByRoomId(roomId: string): Promise<WorkspaceRecord | undefined> {
    const workspace = await this.getByRoomId(roomId);
    return workspace?.status === "active" ? workspace : undefined;
  }

  async bindRoom(binding: WorkspaceRoomBindingRecord): Promise<WorkspaceRoomBindingRecord> {
    this.bindings.set(binding.roomId, binding);
    return binding;
  }
}

class SequentialIdGenerator {
  private next = 1;

  nextId(prefix: string): string {
    return `${prefix}-${this.next++}`;
  }
}

describe("WorkspaceInvitationService", () => {
  it("creates an active Brain workspace and room binding for a trusted invite", async () => {
    const workspaces = new InMemoryWorkspaceRepository();
    const service = new WorkspaceInvitationService(workspaces, new SequentialIdGenerator(), {
      now: () => new Date("2026-08-04T12:00:00.000Z")
    });

    await expect(service.acceptTrustedInvite("!project:example")).resolves.toEqual({
      created: true,
      workspace: expect.objectContaining({
        id: "workspace-1",
        templateId: DEFAULT_ROOM_TEMPLATE_ID,
        templateVersion: DEFAULT_ROOM_TEMPLATE_VERSION,
        configuration: {},
        defaultAgent: "brain",
        status: "active",
        origin: "matrix_invite"
      })
    });
    await expect(workspaces.getByRoomId("!project:example")).resolves.toMatchObject({
      id: "workspace-1",
      status: "active"
    });
    await expect(workspaces.getActiveByRoomId("!project:example")).resolves.toMatchObject({
      id: "workspace-1"
    });
  });

  it("is idempotent when Matrix repeats the same invitation", async () => {
    const workspaces = new InMemoryWorkspaceRepository();
    const service = new WorkspaceInvitationService(workspaces, new SequentialIdGenerator(), {
      now: () => new Date("2026-08-04T12:00:00.000Z")
    });

    await service.acceptTrustedInvite("!project:example");

    await expect(service.acceptTrustedInvite("!project:example")).resolves.toEqual({
      created: false,
      workspace: expect.objectContaining({ id: "workspace-1" })
    });
  });
});
