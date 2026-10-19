import type { WorkspaceRuntimePort } from "@second-brain/application";
import type { PiRunRequestV1, PiRunResultV1 } from "@second-brain/contracts";
import type { WorkspaceRuntimeDescriptor, WorkspaceRuntimeHealth } from "@second-brain/domain";
import type { RuntimeProvisionerClient } from "../../clients/http-runtime-provisioner-client.js";

export class ProvisionerWorkspaceRuntime implements WorkspaceRuntimePort {
  private readonly runtimes = new Map<string, WorkspaceRuntimeDescriptor>();
  private readonly activeRuns = new Map<string, Set<string>>();
  constructor(private readonly provisioner: RuntimeProvisionerClient) {}
  async resolve(workspaceId: string) {
    return this.runtimes.get(workspaceId);
  }
  async provision(input: {
    workspaceId: string;
    templateId: string;
    templateVersion: string;
    configuration: Record<string, unknown>;
  }) {
    await this.provisioner.provisionReviewed(
      input.workspaceId,
      input.templateId,
      input.templateVersion
    );
    const runtime: WorkspaceRuntimeDescriptor = {
      workspaceId: input.workspaceId,
      templateId: input.templateId,
      templateVersion: input.templateVersion,
      health: "ready"
    };
    this.runtimes.set(input.workspaceId, runtime);
    return runtime;
  }
  async run(input: {
    workspaceId: string;
    request: Omit<PiRunRequestV1, "workspaceId">;
  }): Promise<PiRunResultV1> {
    const runs = this.activeRuns.get(input.workspaceId) ?? new Set<string>();
    runs.add(input.request.id);
    this.activeRuns.set(input.workspaceId, runs);
    try {
      return await this.provisioner.run(input.workspaceId, input.request);
    } finally {
      runs.delete(input.request.id);
      if (runs.size === 0) this.activeRuns.delete(input.workspaceId);
    }
  }
  async cancel(workspaceId: string) {
    await Promise.all(
      [...(this.activeRuns.get(workspaceId) ?? [])].map((runId) =>
        this.provisioner.cancel(workspaceId, runId)
      )
    );
  }
  async health(workspaceId: string): Promise<WorkspaceRuntimeHealth> {
    const local = this.runtimes.get(workspaceId);
    if (local) return local.health;
    return this.provisioner.health(workspaceId);
  }
  async archive(workspaceId: string) {
    await this.provisioner.archive(workspaceId);
    const runtime = this.runtimes.get(workspaceId);
    if (runtime) this.runtimes.set(workspaceId, { ...runtime, health: "archived" });
  }
  async destroy(workspaceId: string) {
    await this.provisioner.destroy(workspaceId);
    this.runtimes.delete(workspaceId);
  }
}
