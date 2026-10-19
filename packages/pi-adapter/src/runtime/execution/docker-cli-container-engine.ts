import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, sep } from "node:path";

import type {
  ContainerEnginePort,
  ContainerIsolationConfiguration
} from "../provisioning/runtime-provisioner-service.js";

type ContainerInput = Parameters<ContainerEnginePort["createContainer"]>[0];

type Exec = (file: string, args: readonly string[]) => Promise<string | void>;

const matrixExchangeVolumeName = "jarvis_matrix-exchange";
const matrixExchangeGroupId = "101";
const roleResourceRoot = "/var/lib/jarvis/role-resources";

/** Docker adapter for the privileged runtime-provisioner service only. */
export class DockerCliContainerEngine implements ContainerEnginePort {
  constructor(
    private readonly exec: Exec = defaultExec,
    runtimeEnvironment: Readonly<Record<string, string | undefined>> = process.env,
    private readonly catalogHostPath?: string,
    private readonly runtimeProfileHostRoot?: string
  ) {
    this.runtimeEnvironment = runtimeEnvironmentFrom(runtimeEnvironment);
  }
  private readonly runtimeEnvironment: Readonly<Record<string, string>>;
  async inspectContainer(name: string): Promise<"running" | "stopped" | "missing"> {
    try {
      const output = await this.exec("docker", ["inspect", "--format", "{{.State.Running}}", name]);
      return String(output).trim() === "true" ? "running" : "stopped";
    } catch {
      return "missing";
    }
  }
  async inspectContainerIsolation(
    name: string
  ): Promise<ContainerIsolationConfiguration | undefined> {
    try {
      const output = await this.exec("docker", [
        "inspect",
        "--format",
        '{"HostConfig":{{json .HostConfig}},"Config":{{json .Config}},"Mounts":{{json .Mounts}}}',
        name
      ]);
      return isolationConfiguration(JSON.parse(String(output)) as DockerIsolationInspection);
    } catch {
      return undefined;
    }
  }
  async inspectImage(image: string): Promise<boolean> {
    try {
      await this.exec("docker", ["image", "inspect", image]);
      return true;
    } catch {
      return false;
    }
  }
  startContainer(name: string): Promise<void> {
    return this.exec("docker", ["start", name]).then(() => undefined);
  }
  restartContainer(name: string): Promise<void> {
    return this.exec("docker", ["restart", name])
      .then(() => undefined)
      .catch(async (error: unknown) => {
        // Docker can lose the containerd exit event while restarting. In that
        // state `docker restart` reports failure even though an explicit stop
        // followed by start can restore the existing container and its mounts.
        if (!isMissingExitEventError(error)) throw error;
        await this.stopContainer(name);
        await this.startContainer(name);
      });
  }
  async ensureContainerControlAlias(name: string, alias: string): Promise<void> {
    const output = await this.exec("docker", [
      "inspect",
      "--format",
      "{{json .NetworkSettings.Networks}}",
      name
    ]);
    const networks = JSON.parse(String(output)) as Record<string, { Aliases?: string[] }>;
    if (networks["jarvis-control"]?.Aliases?.includes(alias)) return;
    if (networks["jarvis-control"]) {
      await this.execute("docker", ["network", "disconnect", "jarvis-control", name]);
    }
    await this.execute("docker", ["network", "connect", "--alias", alias, "jarvis-control", name]);
  }
  createVolume(name: string): Promise<void> {
    return this.execute("docker", ["volume", "create", name]);
  }
  createContainer(input: ContainerInput): Promise<void> {
    return this.createAndStart(input);
  }
  private async createAndStart(input: ContainerInput): Promise<void> {
    await this.execute("docker", [
      "create",
      "--name",
      input.name,
      "--read-only",
      "--user",
      "65532:65532",
      // The Matrix exchange is initialized as 100:101 with group read/write
      // permissions. Runtime agents use an unprivileged primary UID/GID and
      // receive this one supplemental group solely for attachment exchange.
      "--group-add",
      matrixExchangeGroupId,
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--pids-limit",
      String(input.pids),
      "--memory",
      `${input.memoryMiB}m`,
      "--cpus",
      formatCpuLimit(input.cpuMillicores),
      "--label",
      `io.jarvis.runtime.timeout-seconds=${input.timeoutSeconds}`,
      // The Browser image keeps its root filesystem read-only, but Playwright
      // needs a session-local temporary directory for traces and browser state.
      ...(input.network === "browser-restricted"
        ? ["--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=256m"]
        : []),
      ...Object.entries(this.runtimeEnvironment).flatMap(([name, value]) => [
        "--env",
        `${name}=${value}`
      ]),
      ...executionIdentityArguments(input.executionIdentity, input.image),
      "--network",
      input.network === "none"
        ? "jarvis-isolated"
        : input.network === "browser-restricted"
          ? "jarvis-browser-restricted"
          : "jarvis-restricted",
      ...(input.mountPolicy === "none"
        ? []
        : [
            "--mount",
            `type=volume,src=${input.volumeName},dst=/workspace${
              input.mountPolicy === "read-only" ? ",readonly" : ""
            }`
          ]),
      "--mount",
      `type=volume,src=${input.sessionVolumeName},dst=/sessions`,
      "--mount",
      `type=volume,src=${matrixExchangeVolumeName},dst=/brain/exchange`,
      ...(this.catalogHostPath
        ? [
            "--mount",
            `type=bind,src=${this.catalogHostPath},dst=/var/lib/jarvis/platform-catalog/platform-catalog.v2.json,readonly`
          ]
        : []),
      ...resourceBundleArguments(input.resourceBundle, this.runtimeProfileHostRoot),
      input.image
    ]);
    try {
      if (input.modelNetwork === "restricted") {
        await this.execute("docker", ["network", "connect", "jarvis-model-restricted", input.name]);
      }
      await this.execute("docker", [
        "network",
        "connect",
        "--alias",
        input.networkAlias,
        "jarvis-control",
        input.name
      ]);
      await this.startContainer(input.name);
    } catch (error) {
      await this.removeContainer(input.name).catch(() => undefined);
      throw error;
    }
  }
  async stopContainer(name: string): Promise<void> {
    try {
      await this.execute("docker", ["stop", name]);
    } catch (error) {
      // Stopping an absent runtime has already achieved the desired state.
      // Keep every other Docker failure visible to the lifecycle caller.
      if (!isMissingContainerError(error)) throw error;
    }
  }
  removeContainer(name: string): Promise<void> {
    return this.execute("docker", ["rm", name]);
  }
  removeVolume(name: string): Promise<void> {
    return this.execute("docker", ["volume", "rm", name]);
  }
  private async execute(file: string, args: readonly string[]): Promise<void> {
    await this.exec(file, args);
  }
}

function executionIdentityArguments(
  identity: ContainerInput["executionIdentity"],
  runtimeImageId: string
): string[] {
  if (!identity) return [];
  return [
    "--env",
    `PI_PLATFORM_POLICY_DIGEST=${identity.platformPolicyDigest}`,
    "--env",
    `PI_RESOURCE_DIGEST=${identity.resourceDigest}`,
    "--env",
    `PI_RUNTIME_IMAGE_ID=${runtimeImageId}`
  ];
}

function resourceBundleArguments(
  bundle: ContainerInput["resourceBundle"],
  runtimeProfileHostRoot: string | undefined
): string[] {
  if (!bundle) return [];
  if (!runtimeProfileHostRoot) {
    throw new Error("RUNTIME_PROFILE_HOST_PATH is required for a reviewed resource bundle");
  }
  const root = resolve(runtimeProfileHostRoot);
  const source = resolve(root, bundle.artifactName);
  if (source !== root && !source.startsWith(`${root}${sep}`)) {
    throw new Error("Reviewed resource bundle escapes the runtime profile directory");
  }
  return [
    "--env",
    `PI_RESOURCE_ROOT=${roleResourceRoot}`,
    "--mount",
    `type=bind,src=${source},dst=${roleResourceRoot},readonly`
  ];
}

function formatCpuLimit(cpuMillicores: number): string {
  return String(cpuMillicores / 1_000);
}

interface DockerIsolationInspection {
  HostConfig?: {
    Memory?: number;
    NanoCpus?: number;
    PidsLimit?: number;
  };
  Config?: { Labels?: Record<string, string> };
  Mounts?: Array<{ Destination?: string; RW?: boolean }>;
}

function isolationConfiguration(
  inspection: DockerIsolationInspection
): ContainerIsolationConfiguration {
  const workspaceMount = inspection.Mounts?.find(({ Destination }) => Destination === "/workspace");
  const host = inspection.HostConfig ?? {};
  return {
    mountPolicy: !workspaceMount ? "none" : workspaceMount.RW ? "read-write" : "read-only",
    timeoutSeconds: Number(inspection.Config?.Labels?.["io.jarvis.runtime.timeout-seconds"] ?? 0),
    memoryMiB: (host.Memory ?? 0) / (1024 * 1024),
    cpuMillicores: (host.NanoCpus ?? 0) / 1_000_000,
    pids: host.PidsLimit ?? 0
  };
}

function runtimeEnvironmentFrom(
  env: Readonly<Record<string, string | undefined>>
): Readonly<Record<string, string>> {
  const names = [
    "PI_MODEL_PROVIDER_ID",
    "PI_MODEL_ID",
    "BRAIN_CONTROL_URL",
    "PLATFORM_CATALOG_PATH"
  ] as const;
  return Object.fromEntries(names.flatMap((name) => (env[name] ? [[name, env[name]]] : [])));
}
async function defaultExec(file: string, args: readonly string[]): Promise<string> {
  const { stdout } = await promisify(execFile)(file, args);
  return stdout;
}

function isMissingContainerError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("No such container:");
}

function isMissingExitEventError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /tried to kill container, but did not receive an exit event/i.test(error.message)
  );
}
