import type { PiRunnerPort, WorkspaceRuntimePort } from "@second-brain/application";
import type { PiRunRequestV1, PiRunResultV1 } from "@second-brain/contracts";
import type { WorkspaceRuntimeHealth } from "@second-brain/domain";

/** Binds Pi execution to a previously provisioned workspace runtime. */
export class PiWorkspaceRuntime implements WorkspaceRuntimePort {
  private readonly activeRuns = new Map<string, Set<string>>();
  constructor(
    private readonly runtimes: WorkspaceRuntimePort,
    private readonly pi: PiRunnerPort
  ) {}
  resolve(workspaceId: string) {
    return this.runtimes.resolve(workspaceId);
  }
  provision(input: {
    workspaceId: string;
    templateId: string;
    templateVersion: string;
    configuration: Record<string, unknown>;
  }) {
    return this.runtimes.provision(input);
  }
  async run(input: {
    workspaceId: string;
    request: Omit<PiRunRequestV1, "workspaceId">;
  }): Promise<PiRunResultV1> {
    if ((await this.runtimes.health(input.workspaceId)) !== "ready")
      throw new Error(`Workspace runtime is not ready: ${input.workspaceId}`);
    const runs = this.activeRuns.get(input.workspaceId) ?? new Set<string>();
    runs.add(input.request.id);
    this.activeRuns.set(input.workspaceId, runs);
    try {
      return await this.pi.run({ ...input.request, workspaceId: input.workspaceId });
    } finally {
      runs.delete(input.request.id);
      if (runs.size === 0) this.activeRuns.delete(input.workspaceId);
    }
  }
  async cancel(workspaceId: string) {
    await Promise.all(
      [...(this.activeRuns.get(workspaceId) ?? [])].map((runId) => this.pi.cancel(runId))
    );
    await this.runtimes.cancel(workspaceId);
  }
  health(workspaceId: string): Promise<WorkspaceRuntimeHealth> {
    return this.runtimes.health(workspaceId);
  }
  archive(workspaceId: string) {
    return this.runtimes.archive(workspaceId);
  }
  destroy(workspaceId: string) {
    return this.cancel(workspaceId).then(() => this.runtimes.destroy(workspaceId));
  }
}
