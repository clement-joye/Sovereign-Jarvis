import type { RuntimeClassPinV2 } from "@second-brain/contracts";

import type { ContainerEnginePort } from "./runtime-provisioner-service.js";
import {
  validateReviewedRuntimeSpecification,
  type ReviewedRuntimeSpecification
} from "./runtime-provisioner-policy.js";
import {
  runtimeEndpointName,
  runtimeName,
  workspaceSessionVolumeName,
  workspaceVolumeName
} from "../identity/runtime-identifiers.js";

export interface RuntimeProvisioningCatalog {
  runtimeClasses(): readonly string[];
  runtimePolicy(runtimeClass: string): RuntimeClassPinV2;
  executionIdentity?(): Parameters<ContainerEnginePort["createContainer"]>[0]["executionIdentity"];
}

/** Owns idempotent container and volume creation for a reviewed runtime specification. */
export class RuntimeContainerProvisioner {
  constructor(
    private readonly engine: ContainerEnginePort,
    private readonly catalog: RuntimeProvisioningCatalog
  ) {}

  async provision(
    workspaceId: string,
    specification: ReviewedRuntimeSpecification
  ): Promise<string> {
    const spec = validateReviewedRuntimeSpecification(specification);
    const runtimeClasses = this.catalog.runtimeClasses();
    const [defaultRuntimeClass] = runtimeClasses;
    if (!defaultRuntimeClass) throw new Error("Agent catalog has no runtime classes");
    const states = await Promise.all(
      runtimeClasses.map((runtimeClass) =>
        this.engine.inspectContainer?.(runtimeName(workspaceId, runtimeClass))
      )
    );
    if (states.every((state) => state === "running")) {
      return runtimeName(workspaceId, defaultRuntimeClass);
    }
    if (states.some((state) => state === "running" || state === "stopped")) {
      await this.completePartialRuntime(workspaceId, spec, runtimeClasses, states);
      return runtimeName(workspaceId, defaultRuntimeClass);
    }
    await this.createRuntime(workspaceId, spec, runtimeClasses);
    return runtimeName(workspaceId, defaultRuntimeClass);
  }

  private async createRuntime(
    workspaceId: string,
    specification: ReviewedRuntimeSpecification,
    runtimeClasses: readonly string[]
  ): Promise<void> {
    const volumeName = workspaceVolumeName(workspaceId);
    const createdContainers: string[] = [];
    try {
      await this.engine.createVolume(volumeName);
      for (const runtimeClass of runtimeClasses) {
        await this.createRuntimeClass({
          workspaceId,
          specification,
          runtimeClass,
          createdContainers
        });
      }
    } catch (error) {
      await this.removeCreatedContainers(createdContainers);
      throw error;
    }
  }

  private async createRuntimeClass(input: {
    workspaceId: string;
    specification: ReviewedRuntimeSpecification;
    runtimeClass: string;
    createdContainers: string[];
  }): Promise<void> {
    const { workspaceId, specification, runtimeClass, createdContainers } = input;
    const image = runtimeImage(specification, runtimeClass);
    if (this.engine.inspectImage && !(await this.engine.inspectImage(image))) {
      throw new Error(`Reviewed runtime image is unavailable: ${image}`);
    }
    const sessionVolumeName = workspaceSessionVolumeName(workspaceId, runtimeClass);
    await this.engine.createVolume(sessionVolumeName);
    const name = runtimeName(workspaceId, runtimeClass);
    await this.engine.createContainer(
      containerConfiguration({
        workspaceId,
        specification,
        runtimeClass,
        policy: this.catalog.runtimePolicy(runtimeClass),
        executionIdentity: this.catalog.executionIdentity?.()
      })
    );
    createdContainers.push(name);
  }

  private async completePartialRuntime(
    workspaceId: string,
    specification: ReviewedRuntimeSpecification,
    runtimeClasses: readonly string[],
    states: readonly ("running" | "stopped" | "missing" | undefined)[]
  ): Promise<void> {
    for (const [index, runtimeClass] of runtimeClasses.entries()) {
      const state = states[index];
      const name = runtimeName(workspaceId, runtimeClass);
      if (state === "stopped") {
        await this.engine.startContainer?.(name);
      } else if (state === "missing") {
        await this.createMissingRuntimeClass(workspaceId, specification, runtimeClass);
      }
    }
  }

  private async createMissingRuntimeClass(
    workspaceId: string,
    specification: ReviewedRuntimeSpecification,
    runtimeClass: string
  ): Promise<void> {
    const image = runtimeImage(specification, runtimeClass);
    if (this.engine.inspectImage && !(await this.engine.inspectImage(image))) {
      throw new Error(`Reviewed runtime image is unavailable: ${image}`);
    }
    await this.engine.createVolume(workspaceSessionVolumeName(workspaceId, runtimeClass));
    await this.engine.createContainer(
      containerConfiguration({
        workspaceId,
        specification,
        runtimeClass,
        policy: this.catalog.runtimePolicy(runtimeClass),
        executionIdentity: this.catalog.executionIdentity?.()
      })
    );
  }

  private async removeCreatedContainers(names: readonly string[]): Promise<void> {
    await Promise.allSettled(
      names.map(async (name) => {
        await this.engine.stopContainer(name).catch(() => undefined);
        await this.engine.removeContainer(name).catch(() => undefined);
      })
    );
  }
}

function containerConfiguration(input: {
  workspaceId: string;
  specification: ReviewedRuntimeSpecification;
  runtimeClass: string;
  policy: RuntimeClassPinV2;
  executionIdentity: Parameters<ContainerEnginePort["createContainer"]>[0]["executionIdentity"];
}) {
  const { workspaceId, specification, runtimeClass, policy, executionIdentity } = input;
  return {
    name: runtimeName(workspaceId, runtimeClass),
    image: runtimeImage(specification, runtimeClass),
    volumeName: workspaceVolumeName(workspaceId),
    sessionVolumeName: workspaceSessionVolumeName(workspaceId, runtimeClass),
    networkAlias: runtimeEndpointName(workspaceId, runtimeClass),
    network: policy.networkPolicy,
    modelNetwork: specification.modelNetwork ?? "none",
    mountPolicy: policy.mountPolicy,
    timeoutSeconds: policy.resourceCeiling.timeoutSeconds,
    memoryMiB: policy.resourceCeiling.memoryMiB,
    cpuMillicores: policy.resourceCeiling.cpuMillicores,
    pids: policy.resourceCeiling.pids,
    ...(executionIdentity ? { executionIdentity } : {}),
    ...(specification.resourceBundle ? { resourceBundle: specification.resourceBundle } : {})
  };
}

function runtimeImage(specification: ReviewedRuntimeSpecification, runtimeClass: string): string {
  return specification.runtimeImages?.[runtimeClass] ?? specification.image;
}
