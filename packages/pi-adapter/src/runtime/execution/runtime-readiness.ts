import type { RuntimeClassPinV2 } from "@second-brain/contracts";

import type { ContainerEnginePort } from "../provisioning/runtime-provisioner-service.js";
import type { WorkspaceRuntimeExecutorPort } from "../workspaces/workspace-runtime-executor.js";

/** Verifies runtime isolation and restores process reachability when possible. */
export class RuntimeReadiness {
  constructor(
    private readonly engine: ContainerEnginePort,
    private readonly executor: WorkspaceRuntimeExecutorPort | undefined,
    private readonly runtimePolicy: (runtimeClass: string) => RuntimeClassPinV2
  ) {}

  async ensureReady(name: string, endpoint: string, runtimeClass: string): Promise<void> {
    const state = await this.engine.inspectContainer?.(name);
    if (state !== undefined && state !== "running") {
      if (state === "stopped" && this.engine.startContainer) await this.engine.startContainer(name);
      else throw new Error(`Workspace runtime is not ready: ${name}`);
    }
    if (!(await this.isolationMatches(name, runtimeClass))) {
      throw new Error(`Workspace runtime isolation does not match catalog policy: ${name}`);
    }
    await this.engine.ensureContainerControlAlias?.(name, endpoint);
    if (!(await this.reachable(endpoint))) await this.restart(name);
    if (!(await this.waitUntilReachable(endpoint))) {
      throw new Error(`Workspace runtime Pi Runner is unavailable: ${name}`);
    }
  }

  async isolationMatches(name: string, runtimeClass: string): Promise<boolean> {
    if (!this.engine.inspectContainerIsolation) return true;
    const actual = await this.engine.inspectContainerIsolation(name);
    if (!actual) return false;
    const expected = this.runtimePolicy(runtimeClass);
    return (
      actual.mountPolicy === physicalMountPolicy(expected.mountPolicy) &&
      actual.timeoutSeconds === expected.resourceCeiling.timeoutSeconds &&
      actual.memoryMiB === expected.resourceCeiling.memoryMiB &&
      actual.cpuMillicores === expected.resourceCeiling.cpuMillicores &&
      actual.pids === expected.resourceCeiling.pids
    );
  }

  async reachable(name: string): Promise<boolean> {
    return this.executor?.health ? this.executor.health(name) : true;
  }

  async restart(name: string): Promise<void> {
    if (this.engine.restartContainer) return this.engine.restartContainer(name);
    if (!this.engine.stopContainer || !this.engine.startContainer) {
      throw new Error(`Workspace runtime cannot be restarted: ${name}`);
    }
    await this.engine.stopContainer(name);
    await this.engine.startContainer(name);
  }

  private async waitUntilReachable(name: string): Promise<boolean> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (await this.reachable(name)) return true;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  }
}

function physicalMountPolicy(
  policy: RuntimeClassPinV2["mountPolicy"]
): "none" | "read-only" | "read-write" {
  // `scoped-write` is a semantic runtime policy enforced by the reviewed
  // workspace guards. Docker realizes it as a read-write /workspace volume,
  // which is the physical property available through container inspection.
  return policy === "scoped-write" ? "read-write" : policy;
}
