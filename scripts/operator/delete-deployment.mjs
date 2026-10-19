#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { access, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const stateRootDefault =
  process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", "Jarvis")
    : join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "jarvis");
const args = process.argv.slice(2);
validateArgs(args);
const stateRoot = resolve(
  optionValue("--state-root") ?? process.env.JARVIS_STATE_ROOT ?? stateRootDefault
);
const yes = args.includes("--yes");
const dryRun = args.includes("--dry-run");
const setupConfig = join(projectRoot, "deploy", "compose", "setup.config.json");
const targetComposeProjects = new Set(["jarvis", "compose"]);
const composeServices = new Set([
  "brain-db",
  "brain-control",
  "brain-worker",
  "brain-delegation-worker",
  "matrix-homeserver",
  "matrix-homeserver-ready",
  "matrix-gateway",
  "matrix-exchange-init",
  "inference-gateway",
  "runtime-provisioner",
  "scheduler",
  "media-worker",
  "whisper-model-init",
  "piper-model-init",
  "retention-worker"
]);
const composeVolumes = new Set([
  "brain-postgres-data",
  "matrix-data",
  "matrix-crypto",
  "matrix-exchange",
  "media-cache",
  "model-cache",
  "media-exchange",
  "pi-config",
  "pi-exchange",
  "pi-sessions",
  "pi-skills",
  "pi-workspace",
  "piper-models",
  "whisper-models"
]);
const composeNetworks = new Set([
  "control_net",
  "matrix_net",
  "model_net",
  "runtime_restricted",
  "runtime_isolated",
  "browser_restricted",
  "model_restricted"
]);

if (args.some((arg) => arg === "--help" || arg === "-h")) {
  process.stdout.write(
    "Usage: pnpm jarvis:delete-deployment [--dry-run] [--yes] [--state-root <path>]\n" +
      "By default, previews the Jarvis Docker resources and protected host state to delete.\n" +
      "Interactive deletion requires typing DELETE JARVIS DEPLOYMENT; --yes skips that prompt.\n"
  );
  process.exit(0);
}

if (dryRun && yes) throw new Error("Use either --dry-run or --yes, not both.");
assertSafeStateRoot(stateRoot);

const containers = inspectContainers();
const volumes = inspectVolumes();
const networks = inspectNetworks();
const files = [
  { path: stateRoot, description: "protected Jarvis setup state, secrets, artifacts, and backups" },
  { path: setupConfig, description: "local deploy/compose/setup.config.json" }
];

process.stdout.write("Jarvis deployment cleanup preview\n");
printItems(
  "Containers",
  containers.map((item) => item.name)
);
printItems(
  "Docker networks",
  networks.map((item) => item.name)
);
printItems(
  "Docker volumes",
  volumes.map((item) => item.name)
);
for (const file of files) process.stdout.write(`  Host path: ${file.path} (${file.description})\n`);
process.stdout.write(
  "Docker images and unrelated Docker resources will be left in place. Matching runtime containers, Compose volumes, protected state, and the local setup config will be permanently deleted.\n"
);

if (dryRun) process.exit(0);
if (
  containers.length + volumes.length + networks.length === 0 &&
  !(await pathExists(stateRoot)) &&
  !(await pathExists(setupConfig))
) {
  process.stdout.write("No Jarvis deployment resources were found.\n");
  process.exit(0);
}

if (!yes && !(await confirmDeletion())) {
  process.stdout.write("Cleanup cancelled.\n");
  process.exit(0);
}

if (containers.length > 0) {
  const containerIds = containers.map((item) => item.id);
  docker(["stop", "--time", "30", ...containerIds]);
  docker(["rm", ...containerIds]);
}
for (const network of networks) docker(["network", "rm", network.id]);
if (volumes.length > 0) docker(["volume", "rm", ...volumes.map((item) => item.name)]);
await rm(stateRoot, { recursive: true, force: true });
await rm(setupConfig, { force: true });
process.stdout.write("Jarvis deployment cleanup completed. Docker images were retained.\n");

function optionValue(name) {
  const index = args.indexOf(name);
  if (index >= 0) {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a path.`);
    return value;
  }
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  return inline?.slice(name.length + 1);
}

function validateArgs(values) {
  for (let index = 0; index < values.length; index += 1) {
    const arg = values[index];
    if (["--help", "-h", "--dry-run", "--yes"].includes(arg)) continue;
    if (arg === "--state-root") {
      const value = values[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--state-root requires a path.");
      index += 1;
      continue;
    }
    if (arg.startsWith("--state-root=") && arg.length > "--state-root=".length) continue;
    throw new Error("Unknown option. Use --help for supported options.");
  }
  if (values.includes("--help") || values.includes("-h")) return;
  if (
    values.filter((arg) => arg === "--state-root" || arg.startsWith("--state-root=")).length > 1
  ) {
    throw new Error("Specify --state-root only once.");
  }
}

function assertSafeStateRoot(path) {
  const filesystemRoot = resolve(sep);
  const home = resolve(homedir());
  if (
    path === filesystemRoot ||
    path === home ||
    path === projectRoot ||
    isAncestor(path, projectRoot) ||
    isAncestor(projectRoot, path)
  ) {
    throw new Error(`Refusing unsafe state root: ${path}`);
  }
}

function isAncestor(parent, child) {
  const path = relative(parent, child);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`));
}

function inspectContainers() {
  const ids = docker(["ps", "--all", "--quiet"]).split(/\s+/u).filter(Boolean);
  const result = [];
  for (const id of ids) {
    const name = docker(["inspect", "--format", "{{.Name}}", id]).replace(/^\//u, "");
    const labels = parseLabels(docker(["inspect", "--format", "{{json .Config.Labels}}", id]));
    const project = labels["com.docker.compose.project"];
    const service = labels["com.docker.compose.service"];
    const runtime = /^jarvis-workspace-[A-Za-z0-9_-]+-[a-z][a-z0-9-]{0,63}$/u.test(name);
    const composeConfig = String(labels["com.docker.compose.project.config_files"] ?? "").includes(
      "deploy/compose/"
    );
    const composeOwned =
      targetComposeProjects.has(project) && composeServices.has(service) && composeConfig;
    if (runtime || composeOwned) {
      result.push({ id, name });
    }
  }
  return result;
}

function inspectVolumes() {
  const names = docker(["volume", "ls", "--quiet"]).split(/\s+/u).filter(Boolean);
  const result = [];
  for (const name of names) {
    const labels = parseLabels(docker(["volume", "inspect", "--format", "{{json .Labels}}", name]));
    const project = labels["com.docker.compose.project"];
    const logicalName = labels["com.docker.compose.volume"];
    const composeOwned =
      targetComposeProjects.has(project) &&
      composeVolumes.has(logicalName) &&
      name === `${project}_${logicalName}`;
    const runtimeOwned = /^jarvis-workspace-(?:data|sessions)-workspace-[A-Za-z0-9_-]+$/u.test(
      name
    );
    if (composeOwned || runtimeOwned) result.push({ name });
  }
  return result;
}

function inspectNetworks() {
  const ids = docker(["network", "ls", "--quiet"]).split(/\s+/u).filter(Boolean);
  const result = [];
  for (const id of ids) {
    const name = docker(["network", "inspect", "--format", "{{.Name}}", id]);
    const labels = parseLabels(docker(["network", "inspect", "--format", "{{json .Labels}}", id]));
    const project = labels["com.docker.compose.project"];
    const logicalName = labels["com.docker.compose.network"];
    if (
      (targetComposeProjects.has(project) && composeNetworks.has(logicalName)) ||
      name === "jarvis-control"
    ) {
      result.push({ id, name });
    }
  }
  return result;
}

function docker(args) {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.error) throw new Error(`Could not run Docker: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = result.stderr.trim();
    throw new Error(`Docker ${args[0]} failed${detail ? `: ${detail}` : "."}`);
  }
  return result.stdout.trim();
}

function parseLabels(value) {
  if (!value || value === "null" || value === "<no value>") return {};
  return JSON.parse(value) ?? {};
}

async function confirmDeletion() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Use --dry-run to preview or --yes to confirm cleanup without a terminal.");
  }
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const response = await readline.question("Type DELETE JARVIS DEPLOYMENT to continue: ");
    return response === "DELETE JARVIS DEPLOYMENT";
  } finally {
    readline.close();
  }
}

function printItems(label, items) {
  process.stdout.write(`${label}: ${items.length ? "" : "none"}\n`);
  for (const item of items) process.stdout.write(`  ${item}\n`);
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
