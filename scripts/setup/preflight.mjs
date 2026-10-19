import { spawnSync } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { constants } from "node:fs";
import { access, lstat, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

export async function runPreflight({
  ports = [8008],
  run = spawnSync,
  architecture = process.arch,
  nodeMajor = Number(process.versions.node.split(".")[0]),
  checkPort = assertPortAvailable,
  checkEndpoint = assertEndpointReachable,
  validateCompose = validateProductionCompose,
  stateRoot,
  inferenceBaseUrl
} = {}) {
  assertSupportedNodeVersion(nodeMajor);
  if (!["x64", "arm64"].includes(architecture))
    throw new Error(`Unsupported host architecture ${architecture}; use an x64 or arm64 host.`);
  check(run, "corepack", ["--version"]);
  check(run, "pnpm", ["--version"]);
  check(run, "docker", ["--version"]);
  check(run, "docker", ["compose", "version"]);
  check(run, "docker", ["buildx", "version"]);
  check(
    run,
    "docker",
    ["info", "--format", "{{.ServerVersion}}"],
    "Start Docker and confirm the current user can access its daemon"
  );
  const buildx = check(
    run,
    "docker",
    ["buildx", "inspect"],
    "Create or select a working Buildx builder with docker buildx create --use"
  );
  const builderStatuses = [...(buildx.stdout ?? "").matchAll(/^\s*Status:\s*(\S+)/gmu)].map(
    (match) => match[1]?.toLowerCase()
  );
  if (builderStatuses.some((status) => status !== "running")) {
    throw new Error(
      "Preflight failed: the selected Buildx builder is not running. Start Docker, select a working builder, and rerun setup."
    );
  }
  await validateCompose({ run });
  if (stateRoot) await assertStateRootWritable(stateRoot);
  for (const port of ports) await checkPort(port);
  if (inferenceBaseUrl) await checkEndpoint(inferenceBaseUrl, "inference endpoint");
}

export function assertSupportedNodeVersion(
  nodeMajor = Number(process.versions.node.split(".")[0])
) {
  if (nodeMajor < 24) {
    throw new Error("Jarvis setup requires Node.js 24 or newer. Select Node 24 and rerun setup.");
  }
}

/**
 * Validate the production Compose model before setup writes its protected environment.
 * Compose requires non-empty values for Matrix fields even though those credentials are
 * intentionally collected only during the later Matrix bootstrap stage. Use isolated,
 * obviously synthetic interpolation values and never pass production.env to Compose.
 */
export async function validateProductionCompose({ run = spawnSync, root = repositoryRoot } = {}) {
  const scratch = await mkdtemp(join(tmpdir(), "jarvis-compose-preflight-"));
  const catalogDir = join(scratch, "catalog");
  const profileDir = join(scratch, "profile");
  await Promise.all([mkdir(catalogDir), mkdir(profileDir)]);
  const envPath = join(scratch, "compose.env");
  const interpolation = {
    POSTGRES_IMAGE:
      "docker.io/library/postgres:16.15-alpine3.24@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea",
    POSTGRES_PASSWORD: "compose-validation-only-postgres-password",
    RUNTIME_PROVISIONER_TOKEN: "compose-validation-only-provisioner-token",
    RUN_AUTHORIZATION_SECRET: "compose-validation-only-run-secret",
    BRAIN_CONTROL_WORKER_COLLABORATION_TOKEN: "compose-validation-only-worker-token",
    PLATFORM_CATALOG_DIR: catalogDir,
    RUNTIME_PROFILE_DIR: profileDir,
    PI_MODEL_PROVIDER_ID: "compose-validation-only-provider",
    PI_MODEL_ID: "compose-validation-only-model",
    INFERENCE_UPSTREAM_BASE_URL: "http://127.0.0.1:8080/v1",
    INFERENCE_SERVER_API_KEY: "compose-validation-only-inference-key",
    MATRIX_SERVER_NAME: "compose-validation.invalid",
    MATRIX_ACCESS_TOKEN: "compose-validation-only-access-token",
    MATRIX_OWNER_ID: "@owner:compose-validation.invalid",
    MATRIX_BRAIN_USER_ID: "@jarvis:compose-validation.invalid",
    MATRIX_RECOVERY_KEY: "compose-validation-only-recovery-key",
    MATRIX_E2EE_ENABLED: "true",
    CONTINUWUITY_ALLOW_REGISTRATION: "false",
    CONTINUWUITY_REGISTRATION_TOKEN: "compose-validation-only-registration-token",
    WHISPER_CPP_MODEL_SHA256: "compose-validation-only-whisper-digest",
    PIPER_MODEL_SHA256: "compose-validation-only-piper-digest",
    PIPER_MODEL_CONFIG_SHA256: "compose-validation-only-piper-config-digest",
    MATRIX_HOST_PORT: "8008",
    WHISPER_CPP_LANGUAGE: "en",
    WHISPER_CPP_MODEL_ID: "compose-validation-only-whisper-model",
    WHISPER_CPP_MODEL_URL: "https://example.invalid/model.bin",
    WHISPER_CPP_REVISION: "compose-validation-only-revision",
    PIPER_VERSION: "compose-validation-only-version",
    SCHEDULE_DISPLAY_TIMEZONE: "Europe/Stockholm",
    AGENT_ROOT_CONCURRENCY: "1",
    AGENT_ADMISSION_LEASE_SECONDS: "90",
    AGENT_ADMISSION_HEARTBEAT_SECONDS: "30",
    BRAIN_CONTROL_PLUGIN_ADMIN_TOKEN: "compose-validation-only-plugin-token",
    JARVIS_PLUGIN_RUNTIME_CONFIG: "{}",
    JARVIS_PLUGIN_CREDENTIALS: "{}",
    LOG_LEVEL: "info"
  };
  try {
    await writeFile(
      envPath,
      `${Object.entries(interpolation)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n")}\n`,
      { mode: 0o600, flag: "wx" }
    );
    const isolatedEnv = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      DOCKER_CONFIG: process.env.DOCKER_CONFIG ?? join(homedir(), ".docker")
    };
    const args = [
      "compose",
      "--project-name",
      "jarvis-setup-preflight",
      "--env-file",
      envPath,
      "-f",
      join(root, "deploy/compose/compose.production.yml"),
      "config",
      "--quiet"
    ];
    const result = run("docker", args, {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
      env: isolatedEnv
    });
    if (result.status !== 0) {
      throw new Error("Preflight failed: production Docker Compose configuration is invalid.");
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function assertStateRootWritable(path) {
  let candidate = resolve(path);
  let existingRoot = true;
  while (true) {
    try {
      const info = await lstat(candidate);
      if (info.isSymbolicLink()) {
        throw new Error(`Setup state path contains a symlink: ${candidate}. Use a real directory.`);
      }
      if (!info.isDirectory())
        throw new Error(`Setup state path is not a directory: ${candidate}.`);
      if (
        existingRoot &&
        ((info.mode & 0o077) !== 0 ||
          (typeof process.getuid === "function" && info.uid !== process.getuid()))
      ) {
        throw new Error(
          `Setup state path must be owned by the current user and private (mode 0700): ${path}. Fix its owner and permissions before setup.`
        );
      }
      await access(candidate, constants.W_OK | constants.X_OK);
      return;
    } catch (error) {
      if (error.code !== "ENOENT") {
        if (error.message.startsWith("Setup state path")) throw error;
        throw new Error(
          `Setup state path is not writable: ${path}. Grant the current user write and search access.`,
          { cause: error }
        );
      }
      const parent = dirname(candidate);
      if (parent === candidate) {
        throw new Error(`Setup state path has no writable parent: ${path}.`);
      }
      candidate = parent;
      existingRoot = false;
    }
  }
}

function check(run, command, args, remedy = `Install or enable ${command} and rerun setup`) {
  let result;
  try {
    result = run(command, args, { encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    throw new Error(`Preflight failed: ${command} ${args.join(" ")} could not run. ${remedy}.`, {
      cause: error
    });
  }
  if (result.status !== 0)
    throw new Error(`Preflight failed: ${command} ${args.join(" ")} is unavailable. ${remedy}.`);
  return result;
}

function assertPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", () =>
      reject(
        new Error(
          `Required loopback port ${port} is unavailable. Stop the process using 127.0.0.1:${port} or choose another Matrix host port.`
        )
      )
    );
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => server.close(resolve));
  });
}

export function assertEndpointReachable(value, label = "endpoint") {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must use HTTP or HTTPS.`);
  }
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: url.hostname.replace(/^\[|\]$/gu, ""), port });
    socket.setTimeout(5_000);
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("error", (error) => {
      socket.destroy();
      reject(
        new Error(
          `Cannot reach ${label} at ${url.origin} from this host. Start the service or fix its URL and network route (${error.code ?? error.message}).`,
          { cause: error }
        )
      );
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(
        new Error(
          `Timed out connecting to ${label} at ${url.origin} from this host. Check the service and private network route.`
        )
      );
    });
  });
}
