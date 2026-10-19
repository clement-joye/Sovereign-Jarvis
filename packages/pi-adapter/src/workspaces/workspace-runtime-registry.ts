import type { WorkspaceRuntimePort } from "@second-brain/application";
import type { WorkspaceRuntimeDescriptor, WorkspaceRuntimeHealth } from "@second-brain/domain";
import type { PiRunResultV1 } from "@second-brain/contracts";

/**
 * Runtime control-plane registry. It accepts only image/release-known template
 * versions; a later container-backed implementation can replace it without
 * changing lifecycle callers.
 */
export class WorkspaceRuntimeRegistry implements WorkspaceRuntimePort {
  private readonly runtimes = new Map<string, WorkspaceRuntimeDescriptor>();

  constructor(private readonly allowedTemplates: ReadonlySet<string>) {}

  async resolve(workspaceId: string): Promise<WorkspaceRuntimeDescriptor | undefined> {
    return this.runtimes.get(workspaceId);
  }

  async provision(input: {
    workspaceId: string;
    templateId: string;
    templateVersion: string;
    configuration: Record<string, unknown>;
  }): Promise<WorkspaceRuntimeDescriptor> {
    const template = `${input.templateId}@${input.templateVersion}`;
    if (!this.allowedTemplates.has(template))
      throw new Error(`Unapproved workspace runtime: ${template}`);
    const runtime: WorkspaceRuntimeDescriptor = {
      workspaceId: input.workspaceId,
      templateId: input.templateId,
      templateVersion: input.templateVersion,
      health: "ready"
    };
    this.runtimes.set(input.workspaceId, runtime);
    return runtime;
  }

  async cancel(_workspaceId: string): Promise<void> {}
  async run(): Promise<PiRunResultV1> {
    throw new Error("Workspace runtime execution is not configured");
  }
  async health(workspaceId: string): Promise<WorkspaceRuntimeHealth> {
    return this.runtimes.get(workspaceId)?.health ?? "unprovisioned";
  }
  async archive(workspaceId: string): Promise<void> {
    const runtime = this.runtimes.get(workspaceId);
    if (runtime) this.runtimes.set(workspaceId, { ...runtime, health: "archived" });
  }
  async destroy(workspaceId: string): Promise<void> {
    this.runtimes.delete(workspaceId);
  }
}
