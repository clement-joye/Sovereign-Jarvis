import { describe, expect, it, vi } from "vitest";
import { DockerCliContainerEngine } from "./docker-cli-container-engine.js";

type DockerExec = (file: string, args: readonly string[]) => Promise<string | void>;
const resourcePolicy = {
  mountPolicy: "read-write" as const,
  timeoutSeconds: 600,
  memoryMiB: 4096,
  cpuMillicores: 4000,
  pids: 512
};

describe("DockerCliContainerEngine", () => {
  it("treats stopping a missing container as an idempotent success", async () => {
    const exec = vi
      .fn<DockerExec>()
      .mockRejectedValue(new Error("Error response from daemon: No such container: runtime-one"));
    const engine = new DockerCliContainerEngine(exec);

    await expect(engine.stopContainer("runtime-one")).resolves.toBeUndefined();
    expect(exec).toHaveBeenCalledWith("docker", ["stop", "runtime-one"]);
  });

  it("does not hide other failures while stopping a container", async () => {
    const exec = vi.fn<DockerExec>().mockRejectedValue(new Error("Docker daemon unavailable"));
    const engine = new DockerCliContainerEngine(exec);

    await expect(engine.stopContainer("runtime-one")).rejects.toThrow("Docker daemon unavailable");
  });

  it("reads the effective isolation settings back from Docker", async () => {
    const exec = vi.fn<DockerExec>().mockResolvedValue(
      JSON.stringify({
        HostConfig: {
          Memory: 768 * 1024 * 1024,
          NanoCpus: 750_000_000,
          PidsLimit: 42
        },
        Config: { Labels: { "io.jarvis.runtime.timeout-seconds": "123" } },
        Mounts: [{ Destination: "/workspace", RW: false }]
      })
    );
    const engine = new DockerCliContainerEngine(exec);

    await expect(engine.inspectContainerIsolation("runtime-one")).resolves.toEqual({
      mountPolicy: "read-only",
      timeoutSeconds: 123,
      memoryMiB: 768,
      cpuMillicores: 750,
      pids: 42
    });
  });

  it("creates a hardened container and attaches its reviewed model network before startup", async () => {
    const exec = vi.fn<DockerExec>().mockResolvedValue(undefined);
    const engine = new DockerCliContainerEngine(exec);
    await engine.createContainer({
      name: "jarvis-workspace-one",
      image: `jarvis/code@sha256:${"a".repeat(64)}`,
      volumeName: "workspace-one",
      sessionVolumeName: "sessions-one",
      networkAlias: "jarvis-runtime-brain-7692c3ad3540bb803c020b3a",
      network: "none",
      modelNetwork: "restricted",
      ...resourcePolicy
    });
    expect(exec).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining([
        "--read-only",
        "--user",
        "65532:65532",
        "--group-add",
        "101",
        "--cap-drop",
        "ALL",
        "--pids-limit",
        "512",
        "--memory",
        "4096m",
        "--cpus",
        "4",
        "--label",
        "io.jarvis.runtime.timeout-seconds=600",
        "--network",
        "jarvis-isolated",
        "--mount",
        "type=volume,src=workspace-one,dst=/workspace",
        "type=volume,src=sessions-one,dst=/sessions",
        "type=volume,src=jarvis_matrix-exchange,dst=/brain/exchange"
      ])
    );
    const args = exec.mock.calls[0]?.[1] ?? [];
    expect(args.join(" ")).not.toContain("docker.sock");
    expect(args.join(" ")).not.toContain("host.docker.internal");
    expect(exec).toHaveBeenNthCalledWith(2, "docker", [
      "network",
      "connect",
      "jarvis-model-restricted",
      "jarvis-workspace-one"
    ]);
    expect(exec).toHaveBeenNthCalledWith(3, "docker", [
      "network",
      "connect",
      "--alias",
      "jarvis-runtime-brain-7692c3ad3540bb803c020b3a",
      "jarvis-control",
      "jarvis-workspace-one"
    ]);
    expect(exec).toHaveBeenNthCalledWith(4, "docker", ["start", "jarvis-workspace-one"]);
  });

  it("removes a not-yet-started container when model-network attachment fails", async () => {
    const exec = vi
      .fn<DockerExec>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("model network unavailable"))
      .mockResolvedValueOnce(undefined);
    const engine = new DockerCliContainerEngine(exec);

    await expect(
      engine.createContainer({
        name: "jarvis-workspace-one",
        image: `jarvis/code@sha256:${"a".repeat(64)}`,
        volumeName: "workspace-one",
        sessionVolumeName: "sessions-one",
        networkAlias: "jarvis-runtime-brain-7692c3ad3540bb803c020b3a",
        network: "restricted",
        modelNetwork: "restricted",
        ...resourcePolicy
      })
    ).rejects.toThrow("model network unavailable");

    expect(exec).toHaveBeenLastCalledWith("docker", ["rm", "jarvis-workspace-one"]);
  });

  it("gives only the Browser runtime a bounded writable temporary directory", async () => {
    const exec = vi.fn<DockerExec>().mockResolvedValue(undefined);
    const engine = new DockerCliContainerEngine(exec);
    await engine.createContainer({
      name: "jarvis-workspace-one-browser",
      image: `jarvis/browser@sha256:${"a".repeat(64)}`,
      volumeName: "workspace-one",
      sessionVolumeName: "sessions-one-browser",
      networkAlias: "jarvis-runtime-browser-7692c3ad3540bb803c020b3a",
      network: "browser-restricted",
      modelNetwork: "none",
      ...resourcePolicy,
      mountPolicy: "none"
    });

    expect(exec.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(["--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=256m"])
    );
    expect(exec.mock.calls[0]?.[1]?.join(" ")).not.toContain("dst=/workspace");
  });

  it("applies the catalog mount mode and CPU, memory, PID, and timeout ceilings", async () => {
    const exec = vi.fn<DockerExec>().mockResolvedValue(undefined);
    const engine = new DockerCliContainerEngine(exec);
    await engine.createContainer({
      name: "jarvis-workspace-one-readonly",
      image: `jarvis/reader@sha256:${"a".repeat(64)}`,
      volumeName: "workspace-one",
      sessionVolumeName: "sessions-one-readonly",
      networkAlias: "jarvis-runtime-readonly-7692c3ad3540bb803c020b3a",
      network: "none",
      modelNetwork: "none",
      mountPolicy: "read-only",
      timeoutSeconds: 123,
      memoryMiB: 768,
      cpuMillicores: 750,
      pids: 42
    });

    expect(exec.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining([
        "--pids-limit",
        "42",
        "--memory",
        "768m",
        "--cpus",
        "0.75",
        "--label",
        "io.jarvis.runtime.timeout-seconds=123",
        "--mount",
        "type=volume,src=workspace-one,dst=/workspace,readonly"
      ])
    );
  });

  it("mounts the verified platform catalog read-only into a dynamic runtime", async () => {
    const exec = vi.fn<DockerExec>().mockResolvedValue(undefined);
    const engine = new DockerCliContainerEngine(
      exec,
      { PLATFORM_CATALOG_PATH: "/var/lib/jarvis/platform-catalog/platform-catalog.v2.json" },
      "/srv/jarvis-release/platform-catalog.v2.json"
    );

    await engine.createContainer({
      name: "jarvis-workspace-one",
      image: `jarvis/code@sha256:${"a".repeat(64)}`,
      volumeName: "workspace-one",
      sessionVolumeName: "sessions-one",
      networkAlias: "jarvis-runtime-brain-7692c3ad3540bb803c020b3a",
      network: "restricted",
      modelNetwork: "none",
      ...resourcePolicy
    });

    expect(exec.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining([
        "--env",
        "PLATFORM_CATALOG_PATH=/var/lib/jarvis/platform-catalog/platform-catalog.v2.json",
        "--mount",
        "type=bind,src=/srv/jarvis-release/platform-catalog.v2.json,dst=/var/lib/jarvis/platform-catalog/platform-catalog.v2.json,readonly"
      ])
    );
  });

  it("mounts the reviewed resource bundle read-only and exposes its runtime path", async () => {
    const exec = vi.fn<DockerExec>().mockResolvedValue(undefined);
    const engine = new DockerCliContainerEngine(exec, {}, "/srv/catalog.json", "/srv/profile");

    await engine.createContainer({
      name: "jarvis-workspace-one",
      image: `jarvis/runtime@sha256:${"a".repeat(64)}`,
      volumeName: "workspace-one",
      sessionVolumeName: "sessions-one",
      networkAlias: "jarvis-runtime-base-one",
      network: "restricted",
      modelNetwork: "none",
      ...resourcePolicy,
      resourceBundle: {
        digest: `sha256:${"b".repeat(64)}`,
        artifactName: "role-resources"
      }
    });

    expect(exec.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining([
        "--env",
        "PI_RESOURCE_ROOT=/var/lib/jarvis/role-resources",
        "--mount",
        "type=bind,src=/srv/profile/role-resources,dst=/var/lib/jarvis/role-resources,readonly"
      ])
    );
  });

  it("fails closed when a reviewed resource bundle has no host release root", async () => {
    const exec = vi.fn<DockerExec>().mockResolvedValue(undefined);
    const engine = new DockerCliContainerEngine(exec);

    await expect(
      engine.createContainer({
        name: "jarvis-workspace-one",
        image: `jarvis/runtime@sha256:${"a".repeat(64)}`,
        volumeName: "workspace-one",
        sessionVolumeName: "sessions-one",
        networkAlias: "jarvis-runtime-base-one",
        network: "restricted",
        modelNetwork: "none",
        ...resourcePolicy,
        resourceBundle: {
          digest: `sha256:${"b".repeat(64)}`,
          artifactName: "role-resources"
        }
      })
    ).rejects.toThrow("RUNTIME_PROFILE_HOST_PATH is required");
    expect(exec).not.toHaveBeenCalled();
  });

  it("passes only non-secret reviewed settings into the runtime", async () => {
    const exec = vi.fn<DockerExec>().mockResolvedValue(undefined);
    const engine = new DockerCliContainerEngine(exec, {
      PI_MODEL_PROVIDER_ID: "omlx",
      PI_MODEL_ID: "Qwen3.6-35B-A3B-OptiQ-4bit",
      INFERENCE_SERVER_API_KEY: "must-not-cross-runtime-boundary",
      BRAIN_CONTROL_URL: "http://brain-control:3000",
      BRAIN_CONTROL_PI_SCHEDULE_TOKEN: "test-schedule-token",
      RUN_AUTHORIZATION_SECRET: "test-run-authorization-signing-secret",
      PLATFORM_CATALOG_PATH: "/catalog/platform-catalog.v2.json"
    });

    await engine.createContainer({
      name: "jarvis-workspace-one",
      image: `jarvis/code@sha256:${"a".repeat(64)}`,
      volumeName: "workspace-one",
      sessionVolumeName: "sessions-one",
      networkAlias: "jarvis-runtime-brain-7692c3ad3540bb803c020b3a",
      network: "none",
      modelNetwork: "none",
      ...resourcePolicy
    });

    expect(exec.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining([
        "--env",
        "PI_MODEL_PROVIDER_ID=omlx",
        "--env",
        "PI_MODEL_ID=Qwen3.6-35B-A3B-OptiQ-4bit",
        "--env",
        "BRAIN_CONTROL_URL=http://brain-control:3000",
        "--env",
        "PLATFORM_CATALOG_PATH=/catalog/platform-catalog.v2.json"
      ])
    );
    expect(
      exec.mock.calls[0]?.[1]?.filter((argument: string) => argument.includes("token"))
    ).toEqual([]);
    expect(
      exec.mock.calls[0]?.[1]?.filter((argument: string) => argument.includes("runtime-boundary"))
    ).toEqual([]);
  });

  it("restarts a named runtime without changing its volumes or network attachments", async () => {
    const exec = vi.fn<DockerExec>().mockResolvedValue(undefined);
    const engine = new DockerCliContainerEngine(exec);

    await engine.restartContainer("jarvis-workspace-one-brain");

    expect(exec).toHaveBeenCalledWith("docker", ["restart", "jarvis-workspace-one-brain"]);
  });

  it("recovers from Docker missing the container exit event during restart", async () => {
    const exec = vi
      .fn<DockerExec>()
      .mockRejectedValueOnce(
        new Error(
          "Error response from daemon: tried to kill container, but did not receive an exit event"
        )
      )
      .mockResolvedValue(undefined);
    const engine = new DockerCliContainerEngine(exec);

    await expect(engine.restartContainer("jarvis-workspace-one-brain")).resolves.toBeUndefined();

    expect(exec).toHaveBeenNthCalledWith(1, "docker", ["restart", "jarvis-workspace-one-brain"]);
    expect(exec).toHaveBeenNthCalledWith(2, "docker", ["stop", "jarvis-workspace-one-brain"]);
    expect(exec).toHaveBeenNthCalledWith(3, "docker", ["start", "jarvis-workspace-one-brain"]);
  });

  it("repairs a missing control-network alias without changing runtime volumes", async () => {
    const exec = vi
      .fn<DockerExec>()
      .mockResolvedValue(JSON.stringify({ "jarvis-control": { Aliases: ["other-name"] } }));
    const engine = new DockerCliContainerEngine(exec);

    await engine.ensureContainerControlAlias(
      "jarvis-workspace-one-brain",
      "jarvis-runtime-brain-7692c3ad3540bb803c020b3a"
    );

    expect(exec).toHaveBeenNthCalledWith(1, "docker", [
      "inspect",
      "--format",
      "{{json .NetworkSettings.Networks}}",
      "jarvis-workspace-one-brain"
    ]);
    expect(exec).toHaveBeenNthCalledWith(2, "docker", [
      "network",
      "disconnect",
      "jarvis-control",
      "jarvis-workspace-one-brain"
    ]);
    expect(exec).toHaveBeenNthCalledWith(3, "docker", [
      "network",
      "connect",
      "--alias",
      "jarvis-runtime-brain-7692c3ad3540bb803c020b3a",
      "jarvis-control",
      "jarvis-workspace-one-brain"
    ]);
  });
});
