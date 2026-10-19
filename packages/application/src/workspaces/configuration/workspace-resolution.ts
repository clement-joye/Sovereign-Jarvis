import type { RoomAgentId, WorkspaceRecord, WorkspaceStatus } from "@second-brain/domain";

import type { WorkspaceRepositoryPort } from "../../ports.js";

export class UnknownWorkspaceRoomError extends Error {
  readonly retryable = false;

  constructor(roomId: string) {
    super(`No active workspace is bound to Matrix room: ${roomId}`);
  }
}

export class UnknownWorkspaceError extends Error {
  readonly retryable = false;

  constructor(workspaceId: string) {
    super(`Unknown workspace: ${workspaceId}`);
  }
}

export interface WorkspaceListFilter {
  status?: WorkspaceStatus | undefined;
}

/** Resolves workspace ownership only from a registered Matrix room binding. */
export class WorkspaceResolutionService {
  constructor(private readonly workspaces: WorkspaceRepositoryPort) {}

  async resolveMatrixRoom(roomId: string): Promise<WorkspaceRecord> {
    const workspace = await this.workspaces.getByRoomId(roomId);
    if (!workspace) throw new UnknownWorkspaceRoomError(roomId);
    return workspace;
  }

  async get(workspaceId: string): Promise<WorkspaceRecord> {
    const workspace = await this.workspaces.get(workspaceId);
    if (!workspace) throw new UnknownWorkspaceError(workspaceId);
    return workspace;
  }

  async getThreadAgent(input: {
    workspaceId: string;
    conversationId: string;
    threadRootExternalEventId: string;
  }): Promise<RoomAgentId | undefined> {
    return this.workspaces.getThreadAgent?.(input);
  }

  async setThreadAgent(input: {
    workspaceId: string;
    conversationId: string;
    threadRootExternalEventId: string;
    agentId: RoomAgentId;
    updatedAt: Date;
  }): Promise<void> {
    await this.workspaces.setThreadAgent?.(input);
  }

  async list(filter: WorkspaceListFilter = {}): Promise<WorkspaceRecord[]> {
    const all = await this.workspaces.list();
    return filter.status ? all.filter((workspace) => workspace.status === filter.status) : all;
  }
}

/** Resolves a bound room for lifecycle commands before the workspace is active. */
export class WorkspaceLifecycleRoomResolutionService {
  constructor(private readonly workspaces: Pick<WorkspaceRepositoryPort, "getByRoomId">) {}

  async resolveBoundMatrixRoom(roomId: string): Promise<WorkspaceRecord> {
    const workspace = await this.workspaces.getByRoomId(roomId);
    if (!workspace) throw new UnknownWorkspaceRoomError(roomId);
    return workspace;
  }
}
