import { readFileSync } from "node:fs";
import { WorkspaceScopedPiRunner, type PiRunnerPort } from "@second-brain/application";
import { HostLocalRuntimeProfileManifestV1Schema } from "@second-brain/contracts";
import type { RuntimeProvisionerClientConfig } from "@second-brain/configuration";
import {
  HttpRuntimeProvisionerClient,
  ProvisionerWorkspaceRuntime
} from "@second-brain/pi-adapter";
export interface WorkerPiRunnerOptions {
  runtimeProvisioner?: RuntimeProvisionerClientConfig;
  currentRuntimeProfilePath?: string;
}

export function createWorkerPiRunner(options: WorkerPiRunnerOptions): PiRunnerPort {
  const template = options.currentRuntimeProfilePath
    ? roomRuntimeTemplate(options.currentRuntimeProfilePath)
    : undefined;
  if (!options.runtimeProvisioner) return new WorkspaceScopedPiRunner();
  const workspaceRuntime = new ProvisionerWorkspaceRuntime(
    new HttpRuntimeProvisionerClient(
      options.runtimeProvisioner.baseUrl,
      options.runtimeProvisioner.token
    )
  );
  return new WorkspaceScopedPiRunner(workspaceRuntime, template);
}

function roomRuntimeTemplate(path: string): { id: string; version: string } | undefined {
  const manifest = HostLocalRuntimeProfileManifestV1Schema.parse(
    JSON.parse(readFileSync(path, "utf8"))
  );
  // `code-project` is the compatibility ID for the reviewed room runtime. It
  // provides the isolated /workspace volume shared by workspace-enabled agents.
  return manifest.currentRuntime.templateId === "code-project"
    ? { id: manifest.currentRuntime.templateId, version: manifest.currentRuntime.templateVersion }
    : undefined;
}
