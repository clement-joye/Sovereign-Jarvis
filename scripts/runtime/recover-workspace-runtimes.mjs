import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const checkOnly = process.argv.slice(2).includes("--check");
const runtimeName = /^jarvis-workspace-([A-Za-z0-9_-]+)-([a-z][a-z0-9-]{0,63})$/;

const names = (await docker(["ps", "-a", "--format", "{{.Names}}"])).stdout
  .split("\n")
  .map((name) => name.trim())
  .filter((name) => runtimeName.test(name));

let unhealthy = 0;
let restarted = 0;
let failedRecovery = 0;
let repairedAliases = 0;
for (const name of names) {
  const controlAliasPresent = await hasControlAlias(name, runtimeAlias(name));
  if (!controlAliasPresent) {
    if (checkOnly) {
      report({ runtime: name, status: "missing_control_alias" });
      continue;
    }
    try {
      await repairControlAlias(name, runtimeAlias(name));
      repairedAliases += 1;
    } catch {
      failedRecovery += 1;
      report({ runtime: name, status: "control_alias_repair_failed" });
      continue;
    }
  }

  const healthy = await piRunnerHealthy(name);
  if (healthy) {
    report({ runtime: name, status: "healthy" });
    continue;
  }

  unhealthy += 1;
  if (checkOnly) {
    report({ runtime: name, status: "unhealthy" });
    continue;
  }

  await docker(["restart", name]);
  restarted += 1;
  const recovered = await waitForHealth(name);
  if (!recovered) failedRecovery += 1;
  report({ runtime: name, status: recovered ? "recovered" : "restart_failed" });
}

report({
  summary: true,
  checked: names.length,
  unhealthy,
  restarted,
  repairedAliases,
  failedRecovery,
  checkOnly
});
if (failedRecovery > 0) process.exitCode = 1;

async function piRunnerHealthy(name) {
  try {
    await docker([
      "exec",
      name,
      "node",
      "-e",
      "fetch('http://127.0.0.1:3010/health',{signal:AbortSignal.timeout(3000)}).then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"
    ]);
    return true;
  } catch {
    return false;
  }
}

async function waitForHealth(name) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (await piRunnerHealthy(name)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function hasControlAlias(name, alias) {
  try {
    const { stdout } = await docker([
      "inspect",
      "--format",
      "{{json .NetworkSettings.Networks}}",
      name
    ]);
    const networks = JSON.parse(stdout);
    return networks["jarvis-control"]?.Aliases?.includes(alias) === true;
  } catch {
    return false;
  }
}

async function repairControlAlias(name, alias) {
  await docker(["network", "disconnect", "jarvis-control", name]);
  await docker(["network", "connect", "--alias", alias, "jarvis-control", name]);
}

function runtimeAlias(name) {
  const match = runtimeName.exec(name);
  if (!match) throw new Error(`Invalid workspace runtime container name: ${name}`);
  const [, workspaceId, agentId] = match;
  return `jarvis-runtime-${agentId}-${createHash("sha256").update(workspaceId).digest("hex").slice(0, 24)}`;
}

async function docker(args) {
  return execFileAsync("docker", args, { encoding: "utf8" });
}

function report(value) {
  process.stdout.write(`${JSON.stringify({ service: "runtime-health-recover", ...value })}\n`);
}
