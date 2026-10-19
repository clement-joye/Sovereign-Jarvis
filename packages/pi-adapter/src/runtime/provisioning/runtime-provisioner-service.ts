import type { AgentCatalog } from "@second-brain/domain";
import {
  minimumTokenBudget,
  tokenBudgetExceeds,
  type PiRunRequestV1,
  type PiRunResultV1,
  type RuntimeClassPinV2
} from "@second-brain/contracts";

import { RuntimeContainerProvisioner } from "./runtime-container-provisioner.js";
import type { ReviewedResourceBundle } from "./runtime-provisioner-policy.js";
import {
  runtimeEndpointName,
  runtimeName,
  workspaceSessionVolumeName,
  workspaceVolumeName
} from "../identity/runtime-identifiers.js";
import type { RuntimeTemplateCatalog } from "./runtime-template-catalog.js";
import type { WorkspaceRuntimeExecutorPort } from "../workspaces/workspace-runtime-executor.js";
import { RuntimeRunCapacity } from "../execution/runtime-run-capacity.js";
import { ActiveRuntimeRuns } from "../execution/active-runtime-runs.js";
import { RuntimeReadiness } from "../execution/runtime-readiness.js";
import { assertRuntimeExecutionIdentity } from "./runtime-execution-identity.js";

export interface RuntimeExecutionIdentity {
  platformPolicyDigest: string;
  resourceDigest: string;
}

export interface ContainerEnginePort {
  inspectImage?(image: string): Promise<boolean>;
  inspectContainer?(name: string): Promise<"running" | "stopped" | "missing">;
  inspectContainerIsolation?(name: string): Promise<ContainerIsolationConfiguration | undefined>;
  startContainer?(name: string): Promise<void>;
  restartContainer?(name: string): Promise<void>;
  ensureContainerControlAlias?(name: string, alias: string): Promise<void>;
  createVolume(name: string): Promise<void>;
  createContainer(input: {
    name: string;
    image: string;
    volumeName: string;
    sessionVolumeName: string;
    networkAlias: string;
    network: "none" | "restricted" | "browser-restricted";
    modelNetwork: "none" | "restricted";
    mountPolicy: RuntimeClassPinV2["mountPolicy"];
    timeoutSeconds: number;
    memoryMiB: number;
    cpuMillicores: number;
    pids: number;
    executionIdentity?: RuntimeExecutionIdentity | undefined;
    resourceBundle?: ReviewedResourceBundle | undefined;
  }): Promise<void>;
  stopContainer(name: string): Promise<void>;
  removeContainer(name: string): Promise<void>;
  removeVolume(name: string): Promise<void>;
}

export interface ContainerIsolationConfiguration {
  mountPolicy: "none" | "read-only" | "read-write";
  timeoutSeconds: number;
  memoryMiB: number;
  cpuMillicores: number;
  pids: number;
}

export interface RuntimeProvisionerOptions {
  engine: ContainerEnginePort;
  templates?: RuntimeTemplateCatalog | undefined;
  executor?: WorkspaceRuntimeExecutorPort | undefined;
  agentCatalog: AgentCatalog;
  runtimePolicies: readonly RuntimeClassPinV2[];
  /** Current reviewed identities injected into every newly created runtime. */
  executionIdentity?: RuntimeExecutionIdentity | undefined;
}

/** Provisions one container per reviewed runtime class, never per agent role. */
export class RuntimeProvisionerService {
  private readonly engine: ContainerEnginePort;
  private readonly templates: RuntimeTemplateCatalog | undefined;
  private readonly executor: WorkspaceRuntimeExecutorPort | undefined;
  private readonly agentCatalog: AgentCatalog;
  private readonly runtimePolicies: readonly RuntimeClassPinV2[];
  private readonly executionIdentity: RuntimeExecutionIdentity | undefined;
  private readonly runCapacity = new RuntimeRunCapacity();
  private readonly activeRuns = new ActiveRuntimeRuns<PiRunResultV1>();
  private readonly containerProvisioner: RuntimeContainerProvisioner;
  private readonly readiness: RuntimeReadiness;

  constructor(options: RuntimeProvisionerOptions) {
    this.engine = options.engine;
    this.templates = options.templates;
    this.executor = options.executor;
    this.agentCatalog = options.agentCatalog;
    this.runtimePolicies = options.runtimePolicies;
    this.executionIdentity = options.executionIdentity;
    this.containerProvisioner = new RuntimeContainerProvisioner(this.engine, {
      runtimeClasses: () => this.runtimeClasses(),
      runtimePolicy: (runtimeClass) => this.runtimePolicy(runtimeClass),
      executionIdentity: () => this.executionIdentity
    });
    this.readiness = new RuntimeReadiness(this.engine, this.executor, (runtimeClass) =>
      this.runtimePolicy(runtimeClass)
    );
    const policyIds = new Set(options.runtimePolicies.map(({ id }) => id));
    for (const runtimeClass of this.runtimeClasses()) {
      if (!policyIds.has(runtimeClass)) {
        throw new Error(`Missing runtime isolation policy for class: ${runtimeClass}`);
      }
    }
  }

  async provisionReviewed(
    workspaceId: string,
    templateId: string,
    templateVersion: string
  ): Promise<string> {
    const entry = this.templates?.get(templateId, templateVersion);
    if (!entry)
      throw new Error(`Unknown reviewed runtime template: ${templateId}@${templateVersion}`);
    return this.containerProvisioner.provision(workspaceId, entry.specification);
  }

  async health(workspaceId: string): Promise<"ready" | "unhealthy" | "unprovisioned"> {
    const runtimeClasses = this.runtimeClasses();
    const states = await Promise.all(
      runtimeClasses.map((runtimeClass) =>
        this.engine.inspectContainer?.(runtimeName(workspaceId, runtimeClass))
      )
    );
    if (states.every((state) => state === "running")) {
      const isolated = await Promise.all(
        runtimeClasses.map((runtimeClass) =>
          this.readiness.isolationMatches(runtimeName(workspaceId, runtimeClass), runtimeClass)
        )
      );
      if (!isolated.every(Boolean)) return "unhealthy";
      const reachable = await Promise.all(
        runtimeClasses.map((runtimeClass) =>
          this.readiness.reachable(runtimeEndpointName(workspaceId, runtimeClass))
        )
      );
      return reachable.every(Boolean) ? "ready" : "unhealthy";
    }
    return states.every((state) => state === "missing" || state === undefined)
      ? "unprovisioned"
      : "unhealthy";
  }

  async run(
    workspaceId: string,
    request: Omit<PiRunRequestV1, "workspaceId">
  ): Promise<PiRunResultV1> {
    if (!this.executor) throw new Error("Workspace runtime executor is unavailable");
    const agent = this.agentCatalog.require(request.agentId ?? this.agentCatalog.defaultAgentId());
    const runtimeClass = this.agentCatalog.runtimeClass(agent.id).id;
    const runtimePolicy = this.runtimePolicy(runtimeClass);
    assertRuntimeExecutionIdentity({
      request,
      image: runtimePolicy.image,
      agentCatalog: this.agentCatalog,
      executionIdentity: this.executionIdentity
    });
    const timeoutCeiling = Math.min(
      agent.timeoutSeconds,
      runtimePolicy.resourceCeiling.timeoutSeconds
    );
    if (request.timeoutSeconds > timeoutCeiling) {
      throw new Error(
        `Pi request timeout ${request.timeoutSeconds}s exceeds the ${timeoutCeiling}s catalog ceiling for ${agent.id}.`
      );
    }
    const tokenBudget = minimumTokenBudget(
      request.tokenBudget,
      agent.tokenBudget,
      runtimePolicy.resourceCeiling.tokenBudget
    );
    if (request.tokenBudget !== undefined && tokenBudgetExceeds(request.tokenBudget, tokenBudget)) {
      throw new Error(
        `Pi request token budget ${request.tokenBudget} exceeds the ${tokenBudget} token catalog ceiling for ${agent.id}.`
      );
    }
    const maxOutputBytes = Math.min(
      request.maxOutputBytes ?? runtimePolicy.resourceCeiling.maxOutputBytes,
      runtimePolicy.resourceCeiling.maxOutputBytes
    );
    if (request.maxOutputBytes !== undefined && request.maxOutputBytes > maxOutputBytes) {
      throw new Error(
        `Pi request output budget ${request.maxOutputBytes} exceeds the ${maxOutputBytes} byte runtime ceiling for ${agent.id}.`
      );
    }
    const runKey = `${workspaceId}:${request.id}`;
    return this.activeRuns.joinOrStart(runKey, async () => {
      const name = runtimeName(workspaceId, runtimeClass);
      const endpoint = runtimeEndpointName(workspaceId, runtimeClass);
      const releaseConcurrency = this.runCapacity.acquire({
        workspaceId,
        agentId: agent.id,
        runtimeClass,
        runtimeLimit: runtimePolicy.resourceCeiling.maxConcurrentRuns,
        agentLimit: agent.maxConcurrentRunsPerWorkspace
      });
      try {
        await this.readiness.ensureReady(name, endpoint, runtimeClass);
        try {
          return await this.executor!.run(endpoint, {
            ...request,
            workspaceId,
            tokenBudget,
            maxOutputBytes
          });
        } catch (error) {
          if (!(await this.readiness.reachable(endpoint))) {
            await this.readiness.restart(name).catch(() => undefined);
          }
          throw error;
        }
      } finally {
        releaseConcurrency();
      }
    });
  }

  async cancel(workspaceId: string, runId: string): Promise<void> {
    if (!this.executor) throw new Error("Workspace runtime executor is unavailable");
    await Promise.all(
      this.runtimeClasses().map((runtimeClass) =>
        this.executor!.cancel(runtimeEndpointName(workspaceId, runtimeClass), runId)
      )
    );
  }

  async executeRuntimeAction(
    workspaceId: string,
    agentId: string,
    operationId: string,
    parameters: Record<string, unknown>
  ): Promise<unknown> {
    if (!this.executor) throw new Error("Workspace runtime executor is unavailable");
    const runtimeClass = this.agentCatalog.runtimeClass(agentId).id;
    const name = runtimeName(workspaceId, runtimeClass);
    const endpoint = runtimeEndpointName(workspaceId, runtimeClass);
    await this.readiness.ensureReady(name, endpoint, runtimeClass);
    if (!this.executor.runtimeAction) throw new Error("Runtime action executor is unavailable");
    return this.executor.runtimeAction(endpoint, operationId, parameters);
  }

  archive(workspaceId: string): Promise<void> {
    return Promise.all(
      this.runtimeClasses().map((runtimeClass) =>
        this.engine.stopContainer(runtimeName(workspaceId, runtimeClass))
      )
    ).then(() => undefined);
  }

  async destroy(workspaceId: string): Promise<void> {
    const runtimeClasses = this.runtimeClasses();
    await Promise.all(
      runtimeClasses.map((runtimeClass) =>
        this.engine.stopContainer(runtimeName(workspaceId, runtimeClass))
      )
    );
    await Promise.all(
      runtimeClasses.map((runtimeClass) =>
        this.engine.removeContainer(runtimeName(workspaceId, runtimeClass))
      )
    );
    await this.engine.removeVolume(workspaceVolumeName(workspaceId));
    await Promise.all(
      runtimeClasses.map((runtimeClass) =>
        this.engine.removeVolume(workspaceSessionVolumeName(workspaceId, runtimeClass))
      )
    );
  }

  private runtimeClasses(): readonly string[] {
    return [
      ...new Set(
        this.agentCatalog.ids().map((agentId) => this.agentCatalog.runtimeClass(agentId).id)
      )
    ];
  }

  private runtimePolicy(runtimeClass: string): RuntimeClassPinV2 {
    const policy = this.runtimePolicies.find(({ id }) => id === runtimeClass);
    if (!policy) throw new Error(`Missing runtime isolation policy for class: ${runtimeClass}`);
    return policy;
  }
}
