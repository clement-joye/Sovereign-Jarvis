import { transitionWorkspace, type ClockPort, type WorkspaceRecord } from "@second-brain/domain";

import type {
  ScheduleRepositoryPort,
  WorkspaceRepositoryPort,
  WorkspaceRuntimePort
} from "../../ports.js";

export class UnknownWorkspaceRoomLifecycleError extends Error {}

/** Applies idempotent room-driven workspace lifecycle changes in the control plane. */
export class WorkspaceRoomLifecycleService {
  constructor(
    private readonly workspaces: Pick<WorkspaceRepositoryPort, "getByRoomId" | "update">,
    private readonly clock: ClockPort,
    private readonly runtime?: Pick<WorkspaceRuntimePort, "cancel" | "archive">,
    private readonly schedules?: Pick<ScheduleRepositoryPort, "disableByWorkspace">
  ) {}

  async archiveRoom(roomId: string): Promise<WorkspaceRecord> {
    const workspace = await this.workspaces.getByRoomId(roomId);
    if (!workspace)
      throw new UnknownWorkspaceRoomLifecycleError(`Unknown workspace room: ${roomId}`);
    if (workspace.status === "archived") return workspace;
    if (workspace.status === "closed") return workspace;
    if (this.schedules?.disableByWorkspace) {
      await this.schedules.disableByWorkspace({ workspaceId: workspace.id, now: this.clock.now() });
    }
    if (this.runtime) {
      await this.runtime.cancel(workspace.id);
      await this.runtime.archive(workspace.id);
    }
    return this.workspaces.update(transitionWorkspace(workspace, "archived", this.clock.now()));
  }
}
