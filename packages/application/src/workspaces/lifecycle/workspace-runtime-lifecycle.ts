import { transitionWorkspace, type ClockPort, type WorkspaceRecord } from "@second-brain/domain";

import type { WorkspaceRepositoryPort, WorkspaceRuntimePort } from "../../ports.js";

export class InactiveWorkspaceRuntimeRecoveryError extends Error {}

export class WorkspaceRuntimeLifecycleService {
  constructor(
    private readonly workspaces: Pick<WorkspaceRepositoryPort, "get" | "update">,
    private readonly runtimes: WorkspaceRuntimePort,
    private readonly clock: ClockPort
  ) {}

  async provision(workspaceId: string): Promise<WorkspaceRecord> {
    const workspace = await this.requireWorkspace(workspaceId);
    if (workspace.status !== "provisioning")
      throw new Error(`Workspace is not provisioning: ${workspaceId}`);
    try {
      const runtime = await this.runtimes.provision({
        workspaceId: workspace.id,
        templateId: workspace.templateId,
        templateVersion: workspace.templateVersion,
        configuration: workspace.configuration
      });
      if (runtime.health !== "ready")
        throw new Error(`Workspace runtime is not ready: ${workspaceId}`);
      return this.workspaces.update(transitionWorkspace(workspace, "active", this.clock.now()));
    } catch (error) {
      await this.workspaces.update(transitionWorkspace(workspace, "failed", this.clock.now()));
      throw error;
    }
  }

  async archive(workspaceId: string): Promise<WorkspaceRecord> {
    const workspace = await this.requireWorkspace(workspaceId);
    if (workspace.status === "archived" || workspace.status === "closed") return workspace;
    await this.runtimes.cancel(workspaceId);
    await this.runtimes.archive(workspaceId);
    return this.workspaces.update(transitionWorkspace(workspace, "archived", this.clock.now()));
  }

  /** Reprovisions only an active runtime that is no longer ready. */
  async recover(workspaceId: string): Promise<WorkspaceRecord> {
    const workspace = await this.requireWorkspace(workspaceId);
    if (workspace.status !== "active") {
      throw new InactiveWorkspaceRuntimeRecoveryError(`Workspace is not active: ${workspaceId}`);
    }
    if ((await this.runtimes.health(workspaceId)) === "ready") return workspace;
    await this.workspaces.update(transitionWorkspace(workspace, "provisioning", this.clock.now()));
    return this.provision(workspaceId);
  }

  private async requireWorkspace(workspaceId: string): Promise<WorkspaceRecord> {
    const workspace = await this.workspaces.get(workspaceId);
    if (!workspace) throw new Error(`Unknown workspace: ${workspaceId}`);
    return workspace;
  }
}
