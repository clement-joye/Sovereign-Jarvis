import type { WorkspaceRecord } from "@second-brain/domain";

import type { WorkspaceRepositoryPort } from "../../ports.js";

export class UnknownWorkspaceRoomRuntimeRecoveryError extends Error {}

/**
 * Recovers a workspace runtime after deriving its identity from a trusted room binding.
 * This keeps workspace identifiers out of transport-facing recovery requests.
 */
export class WorkspaceRoomRuntimeRecoveryService {
  constructor(
    private readonly workspaces: Pick<WorkspaceRepositoryPort, "getByRoomId">,
    private readonly runtimeLifecycle: Pick<WorkspaceRuntimeLifecycleService, "recover">
  ) {}

  async recoverRoom(roomId: string): Promise<WorkspaceRecord> {
    const workspace = await this.workspaces.getByRoomId(roomId);
    if (!workspace) {
      throw new UnknownWorkspaceRoomRuntimeRecoveryError(`Unknown workspace room: ${roomId}`);
    }
    return this.runtimeLifecycle.recover(workspace.id);
  }
}

interface WorkspaceRuntimeLifecycleService {
  recover(workspaceId: string): Promise<WorkspaceRecord>;
}
