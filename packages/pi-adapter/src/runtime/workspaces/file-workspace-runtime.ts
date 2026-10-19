import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { WorkspaceRuntimePort } from "@second-brain/application";
import type { WorkspaceRuntimeDescriptor, WorkspaceRuntimeHealth } from "@second-brain/domain";
import type { PiRunResultV1 } from "@second-brain/contracts";

export class FileWorkspaceRuntime implements WorkspaceRuntimePort {
  private readonly runtimes = new Map<string, WorkspaceRuntimeDescriptor>();
  constructor(
    private readonly root: string,
    private readonly allowedTemplates: ReadonlySet<string>
  ) {}
  async resolve(workspaceId: string) {
    return this.runtimes.get(workspaceId);
  }
  async provision(input: {
    workspaceId: string;
    templateId: string;
    templateVersion: string;
    configuration: Record<string, unknown>;
  }): Promise<WorkspaceRuntimeDescriptor> {
    if (!this.allowedTemplates.has(`${input.templateId}@${input.templateVersion}`))
      throw new Error("Unapproved workspace runtime");
    const root = this.runtimeRoot(input.workspaceId);
    await Promise.all([
      mkdir(join(root, "workspace"), { recursive: true }),
      mkdir(join(root, "sessions"), { recursive: true })
    ]);
    const runtime: WorkspaceRuntimeDescriptor = {
      workspaceId: input.workspaceId,
      templateId: input.templateId,
      templateVersion: input.templateVersion,
      health: "ready"
    };
    this.runtimes.set(input.workspaceId, runtime);
    return runtime;
  }
  async cancel(_workspaceId: string) {}
  async run(): Promise<PiRunResultV1> {
    throw new Error("Workspace runtime execution is not configured");
  }
  async health(workspaceId: string): Promise<WorkspaceRuntimeHealth> {
    return this.runtimes.get(workspaceId)?.health ?? "unprovisioned";
  }
  async archive(workspaceId: string) {
    const runtime = this.runtimes.get(workspaceId);
    if (runtime) this.runtimes.set(workspaceId, { ...runtime, health: "archived" });
  }
  async destroy(workspaceId: string) {
    await rm(this.runtimeRoot(workspaceId), { recursive: true, force: true });
    this.runtimes.delete(workspaceId);
  }
  paths(workspaceId: string) {
    const root = this.runtimeRoot(workspaceId);
    return { root, workspace: join(root, "workspace"), sessions: join(root, "sessions") };
  }
  private runtimeRoot(workspaceId: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(workspaceId)) throw new Error("Invalid workspace runtime id");
    const root = resolve(this.root);
    const path = resolve(root, workspaceId);
    if (!path.startsWith(`${root}/`)) throw new Error("Invalid workspace runtime path");
    return path;
  }
}
