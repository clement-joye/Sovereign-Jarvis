import { spawnSync } from "node:child_process";
import { lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readSetupEnvironmentValues } from "../setup/setup-core.mjs";

const defaultProjectRoot = fileURLToPath(new URL("../..", import.meta.url));
const bootstrapScript = "apps/matrix-gateway/dist/src/bootstrap/bootstrap-e2ee.js";
const statuses = new Set(["unstarted", "ambiguous", "key-persisted"]);

/** Inspect the protected crypto volume without returning a secret. */
export async function readBootstrapStatus(stateRoot, options = {}) {
  const result = await runBootstrapCommand(stateRoot, "--status", options);
  const status = result.trimEnd();
  if (!statuses.has(status)) {
    throw new Error(
      "Matrix recovery handoff returned an invalid status. Stop and inspect protected recovery state."
    );
  }
  return status;
}

/** Return the saved key in memory for direct import into protected setup state. Never log it. */
export async function readBootstrapRecovery(stateRoot, options = {}) {
  const key = await runBootstrapCommand(stateRoot, "--show-recovery-key", options);
  if (!key.endsWith("\n") || key.slice(0, -1).trim() === "" || /[\r\n]/u.test(key.slice(0, -1))) {
    throw new Error(
      "Matrix recovery handoff returned an invalid key. Stop and inspect protected recovery state."
    );
  }
  return key.slice(0, -1);
}

async function runBootstrapCommand(stateRoot, operation, options) {
  const envPath = join(resolve(stateRoot), "production.env");
  const directory = await lstat(resolve(stateRoot));
  const file = await lstat(envPath);
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    (directory.mode & 0o077) !== 0 ||
    !file.isFile() ||
    file.isSymbolicLink() ||
    (file.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" &&
      (directory.uid !== process.getuid() || file.uid !== process.getuid()))
  ) {
    throw new Error(
      "Matrix recovery import requires an owned, private setup directory and environment file."
    );
  }
  const env = await readSetupEnvironmentValues(stateRoot);
  const brainUserId = env.get("MATRIX_BRAIN_USER_ID");
  if (typeof brainUserId !== "string" || !/^@[^:\s]+:[^\s]+$/u.test(brainUserId)) {
    throw new Error(
      "A configured brain Matrix user ID is required to inspect the recovery handoff."
    );
  }
  const projectRoot = options.projectRoot ?? defaultProjectRoot;
  const args = [
    "compose",
    "--project-name",
    "jarvis",
    "--env-file",
    envPath,
    "-f",
    join(projectRoot, "deploy/compose/compose.production.yml"),
    "run",
    "--rm",
    "--no-deps",
    "-T",
    "matrix-gateway",
    "node",
    bootstrapScript,
    operation,
    brainUserId
  ];
  const runCommand = options.runCommand ?? spawnSync;
  const result = runCommand("docker", args, {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 8192,
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") {
    throw new Error(
      "Could not inspect Matrix recovery handoff through Docker Compose. Inspect the protected crypto volume; identity may exist."
    );
  }
  return result.stdout;
}
