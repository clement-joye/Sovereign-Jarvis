import type { WorkspaceRepositoryPort } from "@second-brain/application";
import type { WorkspaceRecord, WorkspaceRoomBindingRecord } from "@second-brain/domain";

export class InMemoryWorkspaceRepository implements WorkspaceRepositoryPort {
  private readonly workspaces = new Map<string, WorkspaceRecord>();
  private readonly bindingsByRoom = new Map<string, WorkspaceRoomBindingRecord>();

  async create(workspace: WorkspaceRecord): Promise<WorkspaceRecord> {
    if (this.workspaces.has(workspace.id)) {
      throw new Error(`Workspace already exists: ${workspace.id}`);
    }
    this.workspaces.set(workspace.id, workspace);
    return workspace;
  }

  async update(workspace: WorkspaceRecord): Promise<WorkspaceRecord> {
    if (!this.workspaces.has(workspace.id)) throw new Error(`Unknown workspace: ${workspace.id}`);
    this.workspaces.set(workspace.id, workspace);
    return workspace;
  }

  async get(id: string): Promise<WorkspaceRecord | undefined> {
    return this.workspaces.get(id);
  }

  async list(): Promise<WorkspaceRecord[]> {
    return [...this.workspaces.values()].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );
  }

  async getByRoomId(roomId: string): Promise<WorkspaceRecord | undefined> {
    const binding = this.bindingsByRoom.get(roomId);
    return binding ? this.workspaces.get(binding.workspaceId) : undefined;
  }

  async getActiveByRoomId(roomId: string): Promise<WorkspaceRecord | undefined> {
    const binding = this.bindingsByRoom.get(roomId);
    if (!binding || binding.status !== "active") return undefined;
    const workspace = this.workspaces.get(binding.workspaceId);
    return workspace?.status === "active" ? workspace : undefined;
  }

  async bindRoom(binding: WorkspaceRoomBindingRecord): Promise<WorkspaceRoomBindingRecord> {
    if (!this.workspaces.has(binding.workspaceId)) {
      throw new Error(`Cannot bind room to unknown workspace: ${binding.workspaceId}`);
    }
    this.bindingsByRoom.set(binding.roomId, binding);
    return binding;
  }
}
