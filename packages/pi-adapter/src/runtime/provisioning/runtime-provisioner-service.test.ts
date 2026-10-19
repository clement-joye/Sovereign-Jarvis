import { describe, expect, it, vi } from "vitest";
import { INITIAL_AGENT_CATALOG } from "@second-brain/domain";
import type { RuntimeClassPinV2 } from "@second-brain/contracts";

import {
  RuntimeProvisionerService,
  type ContainerEnginePort
} from "./runtime-provisioner-service.js";
import { RuntimeTemplateCatalog } from "./runtime-template-catalog.js";
import type { WorkspaceRuntimeExecutorPort } from "../workspaces/workspace-runtime-executor.js";

function createProvisioner(
  ...args: [ContainerEnginePort, RuntimeTemplateCatalog?, WorkspaceRuntimeExecutorPort?]
): RuntimeProvisionerService {
  return new RuntimeProvisionerService({
    engine: args[0],
    templates: args[1],
    executor: args[2],
    agentCatalog: INITIAL_AGENT_CATALOG,
    runtimePolicies: runtimePolicies()
  });
}

function runtimePolicies(): RuntimeClassPinV2[] {
  const classes = [
    { id: "base", mountPolicy: "read-write", pids: 512 },
    { id: "browser", mountPolicy: "none", pids: 512 },
    { id: "isolated", mountPolicy: "scoped-write", pids: 256 }
  ] as const;
  return classes.map(({ id, mountPolicy, pids }) => {
    const agentId = INITIAL_AGENT_CATALOG.ids().find(
      (candidate) => INITIAL_AGENT_CATALOG.runtimeClass(candidate).id === id
    );
    if (!agentId) throw new Error(`Missing test runtime class: ${id}`);
    const runtimeClass = INITIAL_AGENT_CATALOG.runtimeClass(agentId);
    return {
      id,
      image: runtimeClass.image,
      mountPolicy,
      networkPolicy: runtimeClass.networkPolicy,
      featureIds: id === "browser" ? ["browser-automation"] : [],
      resourceCeiling: {
        timeoutSeconds: runtimeClass.timeoutSeconds,
        tokenBudget: 100_000,
        maxConcurrentRuns: runtimeClass.maxConcurrentRuns,
        memoryMiB: runtimeClass.memoryMiB,
        cpuMillicores: runtimeClass.cpuMillicores,
        pids,
        maxOutputBytes: 1_000_000
      }
    };
  });
}

describe("RuntimeProvisionerService", () => {
  it("executes approved browser actions only in the workspace Browser runtime", async () => {
    const runtimeAction = vi.fn().mockResolvedValue({ acted: true });
    const ensureContainerControlAlias = vi.fn();
    const service = createProvisioner(
      {
        inspectContainer: vi.fn().mockResolvedValue("running"),
        ensureContainerControlAlias,
        createVolume: vi.fn(),
        createContainer: vi.fn(),
        stopContainer: vi.fn(),
        removeContainer: vi.fn(),
        removeVolume: vi.fn()
      },
      undefined,
      { health: vi.fn().mockResolvedValue(true), runtimeAction, run: vi.fn(), cancel: vi.fn() }
    );

    await expect(
      service.executeRuntimeAction("one", "browser", "browser-click", { selector: "#save" })
    ).resolves.toEqual({ acted: true });
    expect(ensureContainerControlAlias).toHaveBeenCalledWith(
      "jarvis-workspace-one-browser",
      expect.stringMatching(/^jarvis-runtime-browser-[a-f0-9]{24}$/)
    );
    expect(runtimeAction).toHaveBeenCalledWith(
      expect.stringMatching(/^jarvis-runtime-browser-[a-f0-9]{24}$/),
      "browser-click",
      { selector: "#save" }
    );
  });

  it("reuses complete pairs of running role runtimes", async () => {
    const createContainer = vi.fn();
    const startContainer = vi.fn();
    const states: ("running" | "stopped")[] = [
      "running",
      "running",
      "running",
      "running",
      "running",
      "running"
    ];
    const engine = {
      inspectContainer: async () => states.shift() ?? "missing",
      startContainer,
      createVolume: vi.fn(),
      createContainer,
      stopContainer: vi.fn(),
      removeContainer: vi.fn(),
      removeVolume: vi.fn()
    };
    const catalog = new RuntimeTemplateCatalog([
      {
        templateId: "code-project",
        templateVersion: "1.0.0",
        specification: {
          templateId: "code-project",
          templateVersion: "1.0.0",
          image: `jarvis/code-runtime@sha256:${"a".repeat(64)}`,
          network: "restricted",
          writableVolumeName: "workspace-code"
        }
      }
    ]);
    const service = createProvisioner(engine, catalog);
    await service.provisionReviewed("one", "code-project", "1.0.0");
    await service.provisionReviewed("two", "code-project", "1.0.0");
    expect(createContainer).not.toHaveBeenCalled();
    expect(startContainer).not.toHaveBeenCalled();
  });

  it("completes a workspace runtime when a newly introduced class is missing", async () => {
    const createVolume = vi.fn();
    const createContainer = vi.fn();
    const engine = {
      inspectContainer: vi
        .fn()
        .mockResolvedValueOnce("running")
        .mockResolvedValueOnce("missing")
        .mockResolvedValueOnce("missing"),
      inspectImage: vi.fn().mockResolvedValue(true),
      createVolume,
      createContainer,
      startContainer: vi.fn(),
      stopContainer: vi.fn(),
      removeContainer: vi.fn(),
      removeVolume: vi.fn()
    };
    const catalog = new RuntimeTemplateCatalog([
      {
        templateId: "code-project",
        templateVersion: "1.0.0",
        specification: {
          templateId: "code-project",
          templateVersion: "1.0.0",
          image: `sha256:${"a".repeat(64)}`,
          network: "restricted",
          writableVolumeName: "workspace-code"
        }
      }
    ]);

    await expect(
      createProvisioner(engine, catalog).provisionReviewed("one", "code-project", "1.0.0")
    ).resolves.toBe("jarvis-workspace-one-base");

    expect(createVolume).toHaveBeenCalledWith("jarvis-workspace-sessions-one-browser");
    expect(createVolume).toHaveBeenCalledWith("jarvis-workspace-sessions-one-isolated");
    expect(createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "jarvis-workspace-one-browser",
        volumeName: "jarvis-workspace-data-one",
        sessionVolumeName: "jarvis-workspace-sessions-one-browser"
      })
    );
  });

  it("starts stopped runtime classes without recreating their volumes", async () => {
    const startContainer = vi.fn();
    const engine = {
      inspectContainer: vi.fn().mockResolvedValueOnce("stopped").mockResolvedValueOnce("running"),
      createVolume: vi.fn(),
      createContainer: vi.fn(),
      startContainer,
      stopContainer: vi.fn(),
      removeContainer: vi.fn(),
      removeVolume: vi.fn()
    };
    const catalog = new RuntimeTemplateCatalog([
      {
        templateId: "code-project",
        templateVersion: "1.0.0",
        specification: {
          templateId: "code-project",
          templateVersion: "1.0.0",
          image: `sha256:${"a".repeat(64)}`,
          network: "restricted",
          writableVolumeName: "workspace-code"
        }
      }
    ]);

    await createProvisioner(engine, catalog).provisionReviewed("one", "code-project", "1.0.0");

    expect(startContainer).toHaveBeenCalledExactlyOnceWith("jarvis-workspace-one-base");
    expect(engine.createVolume).not.toHaveBeenCalled();
    expect(engine.createContainer).not.toHaveBeenCalled();
  });
  it("reports runtime health from the container engine", async () => {
    const engine = {
      inspectContainer: vi.fn().mockResolvedValue("running"),
      createVolume: vi.fn(),
      createContainer: vi.fn(),
      stopContainer: vi.fn(),
      removeContainer: vi.fn(),
      removeVolume: vi.fn()
    };
    const service = createProvisioner(engine);
    await expect(service.health("one")).resolves.toBe("ready");
    await expect(service.health("one")).resolves.toBe("ready");
  });
  it("injects the runtime workspace identity only after readiness is confirmed", async () => {
    const run = vi.fn().mockResolvedValue({ status: "completed" });
    const service = createProvisioner(
      {
        inspectContainer: async () => "running",
        createVolume: vi.fn(),
        createContainer: vi.fn(),
        stopContainer: vi.fn(),
        removeContainer: vi.fn(),
        removeVolume: vi.fn()
      },
      undefined,
      { run, cancel: vi.fn() } as never
    );
    await service.run("one", {
      schemaVersion: 1,
      id: "run-1",
      catalogDigest: INITIAL_AGENT_CATALOG.digest,
      traceId: "trace-1",
      sessionId: "session-1",
      inputText: "hello",
      images: [],
      sourceReferences: [],
      timeoutSeconds: 60,
      priority: "interactive"
    });
    expect(run).toHaveBeenCalledWith(
      "jarvis-runtime-base-7692c3ad3540bb803c020b3a",
      expect.objectContaining({ workspaceId: "one" })
    );
  });

  it("fails closed at the provisioner when a current runtime receives missing or mismatched identities", async () => {
    const run = vi.fn().mockResolvedValue({ status: "completed" });
    const runtimeImageId = INITIAL_AGENT_CATALOG.runtimeClass("brain").image;
    const service = new RuntimeProvisionerService({
      engine: {
        inspectContainer: vi.fn().mockResolvedValue("running"),
        createVolume: vi.fn(),
        createContainer: vi.fn(),
        stopContainer: vi.fn(),
        removeContainer: vi.fn(),
        removeVolume: vi.fn()
      },
      executor: { health: vi.fn().mockResolvedValue(true), run, cancel: vi.fn() },
      agentCatalog: INITIAL_AGENT_CATALOG,
      runtimePolicies: runtimePolicies(),
      executionIdentity: {
        platformPolicyDigest: `sha256:${"a".repeat(64)}`,
        resourceDigest: `sha256:${"b".repeat(64)}`
      }
    });
    const request = {
      schemaVersion: 1 as const,
      id: "run-identity",
      traceId: "trace-identity",
      sessionId: "session-identity",
      inputText: "hello",
      images: [],
      sourceReferences: [],
      timeoutSeconds: 60,
      priority: "interactive" as const,
      agentId: "brain"
    };
    await expect(service.run("one", request)).rejects.toThrow("missing an execution identity");
    await expect(
      service.run("one", {
        ...request,
        effectiveRunPolicy: {
          platformPolicyDigest: `sha256:${"a".repeat(64)}`,
          resourceDigest: `sha256:${"b".repeat(64)}`,
          runtimeImageId: `sha256:${"c".repeat(64)}`
        } as never
      })
    ).rejects.toThrow("runtime image does not match");
    await expect(
      service.run("one", {
        ...request,
        effectiveRunPolicy: {
          platformPolicyDigest: `sha256:${"a".repeat(64)}`,
          resourceDigest: `sha256:${"b".repeat(64)}`,
          runtimeImageId
        } as never
      })
    ).resolves.toBeDefined();
    expect(run).toHaveBeenCalledOnce();
  });

  it("rejects a missing or stale catalog before inspecting or calling a runtime", async () => {
    const inspectContainer = vi.fn();
    const run = vi.fn();
    const service = createProvisioner(
      {
        inspectContainer,
        createVolume: vi.fn(),
        createContainer: vi.fn(),
        stopContainer: vi.fn(),
        removeContainer: vi.fn(),
        removeVolume: vi.fn()
      },
      undefined,
      { run, cancel: vi.fn() } as never
    );
    const request = {
      schemaVersion: 1 as const,
      id: "run-stale",
      traceId: "trace-stale",
      sessionId: "session-stale",
      inputText: "hello",
      images: [],
      sourceReferences: [],
      timeoutSeconds: 60,
      priority: "interactive" as const
    };

    await expect(service.run("one", request)).rejects.toThrow("catalog digest missing");
    await expect(
      service.run("one", { ...request, catalogDigest: `sha256:${"b".repeat(64)}` })
    ).rejects.toThrow("does not match provisioner catalog digest");
    expect(inspectContainer).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a run timeout above the agent and runtime catalog ceilings", async () => {
    const inspectContainer = vi.fn();
    const run = vi.fn();
    const service = createProvisioner(
      {
        inspectContainer,
        createVolume: vi.fn(),
        createContainer: vi.fn(),
        stopContainer: vi.fn(),
        removeContainer: vi.fn(),
        removeVolume: vi.fn()
      },
      undefined,
      { run, cancel: vi.fn() } as never
    );

    await expect(
      service.run("one", {
        schemaVersion: 1,
        id: "run-too-long",
        catalogDigest: INITIAL_AGENT_CATALOG.digest,
        traceId: "trace-1",
        sessionId: "session-1",
        inputText: "hello",
        images: [],
        sourceReferences: [],
        timeoutSeconds: 1201,
        priority: "interactive",
        agentId: "brain"
      })
    ).rejects.toThrow("exceeds the 1200s catalog ceiling");
    expect(inspectContainer).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("clamps token and output budgets at the runtime boundary", async () => {
    const run = vi.fn().mockResolvedValue({ status: "completed" });
    const service = createProvisioner(
      {
        inspectContainer: vi.fn().mockResolvedValue("running"),
        createVolume: vi.fn(),
        createContainer: vi.fn(),
        stopContainer: vi.fn(),
        removeContainer: vi.fn(),
        removeVolume: vi.fn()
      },
      undefined,
      { run, cancel: vi.fn() } as never
    );
    const request = {
      schemaVersion: 1 as const,
      id: "run-budgeted",
      catalogDigest: INITIAL_AGENT_CATALOG.digest,
      traceId: "trace-1",
      sessionId: "session-1",
      inputText: "hello",
      images: [],
      sourceReferences: [],
      timeoutSeconds: 60,
      priority: "interactive" as const,
      agentId: "brain"
    };

    await service.run("one", request);
    expect(run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ tokenBudget: 100_000, maxOutputBytes: 1_000_000 })
    );
    await expect(service.run("one", { ...request, tokenBudget: 100_001 })).rejects.toThrow(
      "token catalog ceiling"
    );
    await expect(service.run("one", { ...request, maxOutputBytes: 1_000_001 })).rejects.toThrow(
      "byte runtime ceiling"
    );
  });

  it("fails closed when a live container does not match its catalog isolation policy", async () => {
    const run = vi.fn();
    const service = createProvisioner(
      {
        inspectContainer: vi.fn().mockResolvedValue("running"),
        inspectContainerIsolation: vi.fn().mockResolvedValue({
          mountPolicy: "read-write",
          timeoutSeconds: 600,
          memoryMiB: 1024,
          cpuMillicores: 4000,
          pids: 512
        }),
        createVolume: vi.fn(),
        createContainer: vi.fn(),
        stopContainer: vi.fn(),
        removeContainer: vi.fn(),
        removeVolume: vi.fn()
      },
      undefined,
      { run, cancel: vi.fn() } as never
    );

    await expect(
      service.run("one", {
        schemaVersion: 1,
        id: "run-wrong-isolation",
        catalogDigest: INITIAL_AGENT_CATALOG.digest,
        traceId: "trace-1",
        sessionId: "session-1",
        inputText: "hello",
        images: [],
        sourceReferences: [],
        timeoutSeconds: 60,
        priority: "interactive",
        agentId: "brain"
      })
    ).rejects.toThrow("isolation does not match catalog policy");
    expect(run).not.toHaveBeenCalled();
  });

  it("accepts the read-write Docker mount that realizes scoped-write isolation", async () => {
    const run = vi.fn().mockResolvedValue({ status: "completed" });
    const service = createProvisioner(
      {
        inspectContainer: vi.fn().mockResolvedValue("running"),
        inspectContainerIsolation: vi.fn().mockResolvedValue({
          mountPolicy: "read-write",
          timeoutSeconds: 3200,
          memoryMiB: 2048,
          cpuMillicores: 2000,
          pids: 256
        }),
        createVolume: vi.fn(),
        createContainer: vi.fn(),
        stopContainer: vi.fn(),
        removeContainer: vi.fn(),
        removeVolume: vi.fn()
      },
      undefined,
      { run, cancel: vi.fn() } as never
    );

    await expect(
      service.run("one", {
        schemaVersion: 1,
        id: "run-scheduler",
        catalogDigest: INITIAL_AGENT_CATALOG.digest,
        traceId: "trace-1",
        sessionId: "session-1",
        inputText: "schedule a reminder",
        images: [],
        sourceReferences: [],
        timeoutSeconds: 60,
        priority: "interactive",
        agentId: "scheduler"
      })
    ).resolves.toEqual({ status: "completed" });
    expect(run).toHaveBeenCalledOnce();
  });

  it("enforces the runtime-class concurrency ceiling before model execution", async () => {
    let finishFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const run = vi.fn().mockImplementation(async () => {
      await firstPending;
      return { status: "completed" };
    });
    const service = createProvisioner(
      {
        inspectContainer: vi.fn().mockResolvedValue("running"),
        createVolume: vi.fn(),
        createContainer: vi.fn(),
        stopContainer: vi.fn(),
        removeContainer: vi.fn(),
        removeVolume: vi.fn()
      },
      undefined,
      { run, cancel: vi.fn() } as never
    );
    const request = {
      schemaVersion: 1 as const,
      catalogDigest: INITIAL_AGENT_CATALOG.digest,
      traceId: "trace-1",
      sessionId: "session-1",
      inputText: "hello",
      images: [],
      sourceReferences: [],
      timeoutSeconds: 60,
      priority: "interactive" as const,
      agentId: "brain"
    };

    const first = service.run("one", { ...request, id: "run-1" });
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    await expect(service.run("one", { ...request, id: "run-2" })).rejects.toThrow(
      "Runtime class concurrency ceiling reached"
    );
    finishFirst();
    await expect(first).resolves.toEqual({ status: "completed" });
  });

  it("allows an orchestrator to wait for one isolated child while retaining the class ceiling", async () => {
    let finishRuns!: () => void;
    const pending = new Promise<void>((resolve) => {
      finishRuns = resolve;
    });
    const run = vi.fn().mockImplementation(async () => {
      await pending;
      return { status: "completed" };
    });
    const service = createProvisioner(
      {
        inspectContainer: vi.fn().mockResolvedValue("running"),
        createVolume: vi.fn(),
        createContainer: vi.fn(),
        stopContainer: vi.fn(),
        removeContainer: vi.fn(),
        removeVolume: vi.fn()
      },
      undefined,
      { run, cancel: vi.fn() } as never
    );
    const request = (id: string, agentId: string) => ({
      schemaVersion: 1 as const,
      id,
      catalogDigest: INITIAL_AGENT_CATALOG.digest,
      traceId: "trace-1",
      sessionId: id,
      inputText: "hello",
      images: [],
      sourceReferences: [],
      timeoutSeconds: 60,
      priority: "interactive" as const,
      agentId
    });

    const parent = service.run("one", request("parent", "orchestrator"));
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const child = service.run("one", request("child", "scheduler"));
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    await expect(service.run("one", request("third", "document-analyzer"))).rejects.toThrow(
      "Runtime class concurrency ceiling reached: isolated"
    );
    finishRuns();
    await expect(Promise.all([parent, child])).resolves.toEqual([
      { status: "completed" },
      { status: "completed" }
    ]);
  });

  it("joins an active run when the worker retries the same run id", async () => {
    let finishRun!: () => void;
    const pending = new Promise<void>((resolve) => {
      finishRun = resolve;
    });
    const run = vi.fn().mockImplementation(async () => {
      await pending;
      return { status: "completed", text: "done" };
    });
    const service = createProvisioner(
      {
        inspectContainer: vi.fn().mockResolvedValue("running"),
        createVolume: vi.fn(),
        createContainer: vi.fn(),
        stopContainer: vi.fn(),
        removeContainer: vi.fn(),
        removeVolume: vi.fn()
      },
      undefined,
      { run, cancel: vi.fn() } as never
    );
    const request = {
      schemaVersion: 1 as const,
      id: "run-retried",
      catalogDigest: INITIAL_AGENT_CATALOG.digest,
      traceId: "trace-1",
      sessionId: "session-1",
      inputText: "hello",
      images: [],
      sourceReferences: [],
      timeoutSeconds: 60,
      priority: "interactive" as const,
      agentId: "brain"
    };

    const first = service.run("one", request);
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    const retry = service.run("one", request);
    finishRun();

    await expect(Promise.all([first, retry])).resolves.toEqual([
      { status: "completed", text: "done" },
      { status: "completed", text: "done" }
    ]);
    expect(run).toHaveBeenCalledOnce();
  });

  it("restarts only the selected role when its Pi Runner health endpoint is unavailable", async () => {
    const restartContainer = vi.fn().mockResolvedValue(undefined);
    const ensureContainerControlAlias = vi.fn().mockResolvedValue(undefined);
    const health = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const run = vi.fn().mockResolvedValue({ status: "completed" });
    const service = createProvisioner(
      {
        inspectContainer: async () => "running",
        restartContainer,
        ensureContainerControlAlias,
        createVolume: vi.fn(),
        createContainer: vi.fn(),
        stopContainer: vi.fn(),
        removeContainer: vi.fn(),
        removeVolume: vi.fn()
      },
      undefined,
      { health, run, cancel: vi.fn() } as never
    );

    await service.run("one", {
      schemaVersion: 1,
      id: "run-1",
      catalogDigest: INITIAL_AGENT_CATALOG.digest,
      traceId: "trace-1",
      sessionId: "session-1",
      inputText: "hello",
      images: [],
      sourceReferences: [],
      timeoutSeconds: 60,
      priority: "interactive",
      agentId: "brain"
    });

    expect(restartContainer).toHaveBeenCalledWith("jarvis-workspace-one-base");
    expect(ensureContainerControlAlias).toHaveBeenCalledWith(
      "jarvis-workspace-one-base",
      "jarvis-runtime-base-7692c3ad3540bb803c020b3a"
    );
    expect(run).toHaveBeenCalledWith(
      "jarvis-runtime-base-7692c3ad3540bb803c020b3a",
      expect.anything()
    );
  });

  it("restarts an unreachable runtime after a transport failure without replaying its run", async () => {
    const restartContainer = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const health = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const service = createProvisioner(
      {
        inspectContainer: async () => "running",
        restartContainer,
        createVolume: vi.fn(),
        createContainer: vi.fn(),
        stopContainer: vi.fn(),
        removeContainer: vi.fn(),
        removeVolume: vi.fn()
      },
      undefined,
      { health, run, cancel: vi.fn() } as never
    );

    await expect(
      service.run("one", {
        schemaVersion: 1,
        id: "run-1",
        catalogDigest: INITIAL_AGENT_CATALOG.digest,
        traceId: "trace-1",
        sessionId: "session-1",
        inputText: "hello",
        images: [],
        sourceReferences: [],
        timeoutSeconds: 60,
        priority: "interactive"
      })
    ).rejects.toThrow("fetch failed");

    expect(run).toHaveBeenCalledOnce();
    expect(restartContainer).toHaveBeenCalledWith("jarvis-workspace-one-base");
  });
  it("creates reviewed runtime resources and destroys them in dependency order", async () => {
    const calls: string[] = [];
    const engine = {
      createVolume: vi.fn(async () => {
        calls.push("volume");
      }),
      createContainer: vi.fn(async () => {
        calls.push("container");
      }),
      stopContainer: vi.fn(async () => {
        calls.push("stop");
      }),
      removeContainer: vi.fn(async () => {
        calls.push("container-remove");
      }),
      removeVolume: vi.fn(async () => {
        calls.push("volume-remove");
      })
    };
    const catalog = new RuntimeTemplateCatalog([
      {
        templateId: "code-project",
        templateVersion: "1.0.0",
        specification: {
          templateId: "code-project",
          templateVersion: "1.0.0",
          image: `jarvis/code-runtime@sha256:${"a".repeat(64)}`,
          network: "restricted",
          writableVolumeName: "workspace-one"
        }
      }
    ]);
    const service = createProvisioner(engine, catalog);
    await expect(service.provisionReviewed("one", "code-project", "1.0.0")).resolves.toBe(
      "jarvis-workspace-one-base"
    );
    await service.destroy("one");
    expect(calls).toEqual([
      "volume",
      "volume",
      "container",
      "volume",
      "container",
      "volume",
      "container",
      "stop",
      "stop",
      "stop",
      "container-remove",
      "container-remove",
      "container-remove",
      "volume-remove",
      "volume-remove",
      "volume-remove",
      "volume-remove"
    ]);
    expect(engine.createVolume).toHaveBeenCalledWith("jarvis-workspace-data-one");
    expect(engine.createVolume).toHaveBeenCalledWith("jarvis-workspace-sessions-one-base");
  });
  it("uses one reviewed image and container for a shared runtime class", async () => {
    const createContainer = vi.fn();
    const engine = {
      inspectContainer: async () => "missing" as const,
      inspectImage: async () => true,
      createVolume: vi.fn(),
      createContainer,
      stopContainer: vi.fn(),
      removeContainer: vi.fn(),
      removeVolume: vi.fn()
    };
    const catalog = new RuntimeTemplateCatalog([
      {
        templateId: "code-project",
        templateVersion: "1.0.0",
        specification: {
          templateId: "code-project",
          templateVersion: "1.0.0",
          image: `sha256:${"a".repeat(64)}`,
          network: "restricted",
          writableVolumeName: "workspace-one"
        }
      }
    ]);
    await createProvisioner(engine, catalog).provisionReviewed("one", "code-project", "1.0.0");
    expect(createContainer).toHaveBeenCalledTimes(3);
    expect(createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "jarvis-workspace-one-base",
        image: `sha256:${"a".repeat(64)}`,
        volumeName: "jarvis-workspace-data-one",
        sessionVolumeName: "jarvis-workspace-sessions-one-base",
        networkAlias: "jarvis-runtime-base-7692c3ad3540bb803c020b3a"
      })
    );
  });

  it("forwards the reviewed resource bundle to every runtime class", async () => {
    const createContainer = vi.fn();
    const engine = {
      inspectContainer: async () => "missing" as const,
      inspectImage: async () => true,
      createVolume: vi.fn(),
      createContainer,
      stopContainer: vi.fn(),
      removeContainer: vi.fn(),
      removeVolume: vi.fn()
    };
    const resourceBundle = {
      digest: `sha256:${"b".repeat(64)}`,
      artifactName: "role-resources"
    };
    const catalog = new RuntimeTemplateCatalog([
      {
        templateId: "code-project",
        templateVersion: "1.0.0",
        specification: {
          templateId: "code-project",
          templateVersion: "1.0.0",
          image: `sha256:${"a".repeat(64)}`,
          network: "restricted",
          writableVolumeName: "workspace-one",
          resourceBundle
        }
      }
    ]);

    await createProvisioner(engine, catalog).provisionReviewed("one", "code-project", "1.0.0");

    expect(createContainer).toHaveBeenCalledTimes(3);
    for (const call of createContainer.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ resourceBundle }));
    }
  });

  it("selects runtime specifications only from the trusted catalog", async () => {
    const catalog = new RuntimeTemplateCatalog([
      {
        templateId: "code-project",
        templateVersion: "1.0.0",
        specification: {
          templateId: "code-project",
          templateVersion: "1.0.0",
          image: `jarvis/code@sha256:${"a".repeat(64)}`,
          network: "none",
          writableVolumeName: "workspace-two"
        }
      }
    ]);
    const engine = {
      createVolume: async () => undefined,
      createContainer: async () => undefined,
      stopContainer: async () => undefined,
      removeContainer: async () => undefined,
      removeVolume: async () => undefined
    };
    const service = createProvisioner(engine, catalog);
    await expect(service.provisionReviewed("two", "code-project", "1.0.0")).resolves.toBe(
      "jarvis-workspace-two-base"
    );
    await expect(service.provisionReviewed("two", "code-project", "2.0.0")).rejects.toThrow(
      "Unknown reviewed"
    );
  });

  it("derives distinct volumes for workspaces sharing one reviewed template", async () => {
    const volumes: string[] = [];
    const catalog = new RuntimeTemplateCatalog([
      {
        templateId: "code-project",
        templateVersion: "1.0.0",
        specification: {
          templateId: "code-project",
          templateVersion: "1.0.0",
          image: `jarvis/code@sha256:${"a".repeat(64)}`,
          network: "none",
          writableVolumeName: "ignored-template-value"
        }
      }
    ]);
    const engine = {
      createVolume: async (name: string) => {
        volumes.push(name);
      },
      createContainer: async () => undefined,
      stopContainer: async () => undefined,
      removeContainer: async () => undefined,
      removeVolume: async () => undefined
    };
    const service = createProvisioner(engine, catalog);
    await service.provisionReviewed("one", "code-project", "1.0.0");
    await service.provisionReviewed("two", "code-project", "1.0.0");
    expect(volumes).toEqual([
      "jarvis-workspace-data-one",
      "jarvis-workspace-sessions-one-base",
      "jarvis-workspace-sessions-one-isolated",
      "jarvis-workspace-sessions-one-browser",
      "jarvis-workspace-data-two",
      "jarvis-workspace-sessions-two-base",
      "jarvis-workspace-sessions-two-isolated",
      "jarvis-workspace-sessions-two-browser"
    ]);
  });

  it("removes created containers but preserves volumes when provisioning fails", async () => {
    const calls: string[] = [];
    const catalog = new RuntimeTemplateCatalog([
      {
        templateId: "code-project",
        templateVersion: "1.0.0",
        specification: {
          templateId: "code-project",
          templateVersion: "1.0.0",
          image: `jarvis/code@sha256:${"a".repeat(64)}`,
          network: "none",
          writableVolumeName: "ignored"
        }
      }
    ]);
    const service = createProvisioner(
      {
        createVolume: async () => {
          calls.push("volume");
        },
        createContainer: async (input: { name: string }) => {
          if (input.name.endsWith("-browser")) throw new Error("engine failed");
        },
        stopContainer: async (name: string) => {
          calls.push(`stop:${name}`);
        },
        removeContainer: async (name: string) => {
          calls.push(`remove:${name}`);
        },
        removeVolume: async () => {
          calls.push("volume-remove");
        }
      },
      catalog
    );
    await expect(service.provisionReviewed("failed", "code-project", "1.0.0")).rejects.toThrow(
      "engine failed"
    );
    expect(calls).toEqual([
      "volume",
      "volume",
      "volume",
      "volume",
      "stop:jarvis-workspace-failed-base",
      "stop:jarvis-workspace-failed-isolated",
      "remove:jarvis-workspace-failed-base",
      "remove:jarvis-workspace-failed-isolated"
    ]);
  });

  it("uses the dedicated browser image for the browser runtime class", async () => {
    const createContainer = vi.fn();
    const engine = {
      inspectContainer: async () => "missing" as const,
      inspectImage: async () => true,
      createVolume: vi.fn(),
      createContainer,
      stopContainer: vi.fn(),
      removeContainer: vi.fn(),
      removeVolume: vi.fn()
    };
    const catalog = new RuntimeTemplateCatalog([
      {
        templateId: "code-project",
        templateVersion: "1.0.0",
        specification: {
          templateId: "code-project",
          templateVersion: "1.0.0",
          image: `sha256:${"a".repeat(64)}`,
          runtimeImages: { browser: `sha256:${"b".repeat(64)}` },
          network: "restricted",
          writableVolumeName: "workspace-one"
        }
      }
    ]);

    await createProvisioner(engine, catalog).provisionReviewed("one", "code-project", "1.0.0");

    expect(createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "jarvis-workspace-one-browser",
        image: `sha256:${"b".repeat(64)}`,
        network: "browser-restricted"
      })
    );
  });
});
