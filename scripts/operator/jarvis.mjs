#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, openSync, closeSync } from "node:fs";
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defaultStateRoot } from "../setup/setup-core.mjs";
import {
  assertInstallReady,
  assertSetupEnvironment,
  ensureContainerArtifactAccess
} from "../setup/install-readiness.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const commands = new Set(["start", "stop", "status", "logs", "update", "backup", "restore"]);

export function parseArgs(args) {
  if (args.includes("--help") || args.length === 0) return { help: true };
  const [command, ...forwarded] = args;
  const rest = forwarded[0] === "--" ? forwarded.slice(1) : forwarded;
  if (!commands.has(command)) throw new Error(`Unknown command: ${command}`);
  const options = { command, positional: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--state-root" || arg === "--tail") {
      const value = rest[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
      if (arg === "--tail" && !/^\d+$/u.test(value))
        throw new Error("--tail must be a non-negative integer.");
      options[arg === "--state-root" ? "stateRoot" : "tail"] = value;
      index += 1;
    } else if (["--follow", "--yes", "--confirm-interruption"].includes(arg)) {
      options[arg.slice(2).replaceAll("-", "")] = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      options.positional.push(arg);
    }
  }
  return options;
}

export async function runOperator(options, dependencies = {}) {
  const run = dependencies.run ?? runCommand;
  const output = dependencies.output ?? ((text) => process.stdout.write(text));
  const confirm = dependencies.confirm ?? confirmRestore;
  const stateRoot = resolve(
    options.stateRoot ??
      process.env.JARVIS_STATE_ROOT ??
      defaultStateRoot({
        platform: process.platform,
        home: homedir(),
        xdgStateHome: process.env.XDG_STATE_HOME
      })
  );
  const envFile = join(stateRoot, "production.env");
  const composeFile = resolve(
    projectRoot,
    dependencies.composeFile ?? "deploy/compose/compose.production.yml"
  );
  const projectName = dependencies.projectName ?? "jarvis";
  const compose = dependencies.composeArgs ?? [
    "compose",
    "--project-name",
    projectName,
    "--env-file",
    envFile,
    "-f",
    composeFile
  ];

  if (options.help) {
    output(
      "Usage: pnpm jarvis:<start|stop|status|logs|update|backup|restore> [options]\n" +
        "Options: --state-root <path>, --tail <count>, --follow, --confirm-interruption, --yes\n"
    );
    return 0;
  }
  if (!options.command) throw new Error("A Jarvis operator command is required.");
  await assertSetupEnvironment(stateRoot);
  // Updates publish replacement artifacts and can repair a stale catalog/profile
  // pair. Startup still requires the installed pair to be consistent.
  if (options.command === "start") {
    await assertInstallReady(stateRoot);
  }
  if (options.command === "update") await ensureContainerArtifactAccess(stateRoot);

  switch (options.command) {
    case "start":
      run("docker", [...compose, "up", "--detach", "--wait"]);
      output("Jarvis services are started. Use `pnpm jarvis:status` to inspect service health.\n");
      break;
    case "stop":
      run("docker", [...compose, "stop"]);
      output("Jarvis services are stopped. Persistent volumes were preserved.\n");
      break;
    case "status":
      await showStatus({ run, output, compose, stateRoot });
      break;
    case "logs": {
      const tail = options.tail ?? "100";
      const args = [...compose, "logs", `--tail=${tail}`];
      if (options.follow) args.push("--follow");
      args.push(...options.positional);
      run("docker", args, { stdio: "inherit" });
      break;
    }
    case "update":
      await update({ options, run, output, compose, stateRoot, envFile, projectName, composeFile });
      break;
    case "backup":
      await createBackup({ run, output, compose, stateRoot });
      break;
    case "restore":
      await restoreBackup({ options, run, output, confirm, compose, stateRoot });
      break;
    default:
      throw new Error(`Unsupported command: ${options.command}`);
  }
  return 0;
}

async function showStatus({ run, output, compose, stateRoot }) {
  const services = run("docker", [...compose, "ps", "--format", "json"], { capture: true });
  output("Services:\n");
  for (const line of services.toString("utf8").split(/\r?\n/u).filter(Boolean)) {
    const service = JSON.parse(line);
    const name = service.Service ?? service.Name ?? "unknown service";
    const state = service.State ?? "unknown";
    const health = typeof service.Health === "string" ? service.Health.trim() : "";
    const degraded = state !== "running" || (health !== "" && health !== "healthy");
    output(
      `  ${name}: ${state}${health ? ` (${health})` : ""}${degraded ? ` — degraded; inspect with \`pnpm jarvis:logs ${name}\` and start or repair the service` : ""}\n`
    );
  }
  for (const [label, path, fields] of [
    [
      "Platform catalog",
      join(stateRoot, "platform-catalog", "platform-catalog.v2.json"),
      [
        [["digest"], "digest"],
        [["catalogDigest"], "catalogDigest"]
      ]
    ],
    [
      "Runtime profile",
      join(stateRoot, "runtime-profile", "current-runtime.json"),
      [
        [["currentRuntime", "imageId"], "imageId"],
        [["profileArtifact", "source", "digest"], "sourceDigest"],
        [["currentRuntime", "resourceBundle", "digest"], "resourceBundleDigest"]
      ]
    ]
  ]) {
    try {
      const value = JSON.parse(await readFile(path, "utf8"));
      const identity = fields
        .map(([pathParts, label]) => {
          const fieldValue = pathParts.reduce((current, part) => current?.[part], value);
          return fieldValue ? `${label}=${fieldValue}` : undefined;
        })
        .filter(Boolean)
        .join(", ");
      output(`  ${label}: ${identity || "present"}\n`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      output(
        `  ${label}: missing — degraded; quiesce active runs, then run \`pnpm jarvis:update runtime --confirm-interruption\` to rebuild the reviewed profile and catalog. During initial setup, use \`pnpm jarvis:setup --publish-artifacts\` instead.\n`
      );
    }
  }
  try {
    const migration = run(
      "docker",
      [
        ...compose,
        "exec",
        "-T",
        "brain-db",
        "psql",
        "-At",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "brain",
        "-d",
        "brain",
        "-c",
        "SELECT migration_number FROM brain_core.schema_metadata WHERE singleton"
      ],
      { capture: true }
    );
    output(`  Database migration: ${migration.toString("utf8").trim() || "unavailable"}\n`);
  } catch {
    output(
      "  Database migration: unavailable — degraded; inspect `pnpm jarvis:logs brain-db`, then run `pnpm jarvis:setup --migrate` after resolving database issues\n"
    );
  }
}

async function update({
  options,
  run,
  output,
  compose,
  stateRoot,
  envFile,
  projectName,
  composeFile
}) {
  const [kind] = options.positional;
  if (!new Set(["application", "runtime", "resources"]).has(kind)) {
    throw new Error("Choose one update target: application, runtime, or resources.");
  }
  if (kind !== "application" && !options.confirminterruption) {
    throw new Error(
      "Runtime and resource updates can interrupt active runs. Quiesce work, then repeat with --confirm-interruption."
    );
  }
  if (kind === "application") {
    output(
      "Applying the reviewed checkout, catalog, and forward-only database migrations. Back up first; recovery requires restoring that backup.\n"
    );
    run("pnpm", ["install", "--frozen-lockfile"]);
    run(process.execPath, [
      resolve(projectRoot, "scripts/migrations/apply-database-migrations.mjs"),
      "--project-name",
      projectName,
      "--env-file",
      envFile,
      "--compose-file",
      composeFile
    ]);
    run(process.execPath, [
      resolve(projectRoot, "scripts/runtime/update-host-local-runtime-profile.mjs"),
      "--env-file",
      envFile,
      "--compose-file",
      composeFile,
      "--runtime-profile-dir",
      join(stateRoot, "runtime-profile"),
      "--platform-catalog-dir",
      join(stateRoot, "platform-catalog"),
      "--resources-only",
      "--publish-only"
    ]);
    run("docker", [...compose, "up", "--build", "--detach", "--wait"]);
    return;
  }
  const script = resolve(projectRoot, "scripts/runtime/update-host-local-runtime-profile.mjs");
  run(
    process.execPath,
    [
      script,
      "--env-file",
      envFile,
      "--compose-file",
      resolve(projectRoot, "deploy/compose/compose.production.yml"),
      "--runtime-profile-dir",
      join(stateRoot, "runtime-profile"),
      "--platform-catalog-dir",
      join(stateRoot, "platform-catalog"),
      ...(kind === "resources" ? ["--resources-only"] : [])
    ],
    { stdio: "inherit" }
  );
}

async function createBackup({ run, output, compose, stateRoot }) {
  const backupRoot = join(stateRoot, "backups");
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const destination = join(backupRoot, `jarvis-${stamp}`);
  await mkdir(destination, { mode: 0o700 });
  try {
    const dumpPath = join(destination, "database.dump");
    await run(
      "docker",
      [...compose, "exec", "-T", "brain-db", "pg_dump", "-U", "brain", "-d", "brain", "-Fc"],
      { outputFile: dumpPath }
    );
    const dumpInfo = await stat(dumpPath);
    if (!dumpInfo.size) throw new Error("PostgreSQL returned an empty backup.");
    for (const name of ["platform-catalog", "runtime-profile"]) {
      const source = join(stateRoot, name);
      await cp(source, join(destination, name), {
        recursive: true,
        errorOnExist: true,
        force: false,
        preserveTimestamps: true
      });
    }
    const digest = await hashFile(dumpPath);
    await writeFile(
      join(destination, "manifest.json"),
      `${JSON.stringify({ version: 1, databaseSha256: digest, createdAt: new Date().toISOString() }, null, 2)}\n`,
      { mode: 0o600, flag: "wx" }
    );
    output(`Backup created at ${destination}\n`);
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}

async function restoreBackup({ options, run, output, confirm, compose, stateRoot }) {
  const backup = resolve(options.positional[0] ?? "");
  if (!options.positional[0]) throw new Error("restore requires a backup directory path.");
  const manifest = JSON.parse(await readFile(join(backup, "manifest.json"), "utf8"));
  if (manifest.version !== 1) throw new Error("Unsupported backup manifest version.");
  const dumpPath = join(backup, "database.dump");
  const actual = await hashFile(dumpPath);
  if (actual !== manifest.databaseSha256)
    throw new Error("Backup database checksum does not match its manifest.");
  for (const name of ["platform-catalog", "runtime-profile"]) {
    const info = await stat(join(backup, name));
    if (!info.isDirectory()) throw new Error(`Backup is missing ${name}.`);
  }
  const accepted =
    options.yes ||
    (await confirm(
      `This will overwrite Jarvis database, catalog, and runtime profile from ${backup}. Current data remains recoverable only from a separate backup. Type RESTORE to continue: `
    ));
  if (!accepted) throw new Error("Restore cancelled; no changes were made.");

  await run("docker", [...compose, "stop"]);
  await run("docker", [...compose, "up", "--detach", "--wait", "brain-db"]);
  await run(
    "docker",
    [
      ...compose,
      "exec",
      "-T",
      "brain-db",
      "pg_restore",
      "--clean",
      "--if-exists",
      "--no-owner",
      "-U",
      "brain",
      "-d",
      "brain"
    ],
    { inputFile: dumpPath }
  );
  for (const name of ["platform-catalog", "runtime-profile"]) {
    const target = join(stateRoot, name);
    const staged = `${target}.restore-${process.pid}`;
    const previous = `${target}.pre-restore-${process.pid}`;
    await cp(join(backup, name), staged, { recursive: true, errorOnExist: true, force: false });
    await rename(target, previous).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    try {
      await rename(staged, target);
    } catch (error) {
      await rename(previous, target).catch(() => undefined);
      throw error;
    }
  }
  await ensureContainerArtifactAccess(stateRoot);
  // Restored directories replace the old bind sources by rename. Recreate
  // containers so Docker binds the restored directories rather than old inodes.
  await run("docker", [...compose, "up", "--detach", "--wait", "--force-recreate"]);
  output(
    `Restore completed from ${backup}. Previous catalog/profile directories were retained with .pre-restore-${process.pid} suffixes.\n`
  );
}

function runCommand(command, args, options = {}) {
  let outputFd;
  let inputFd;
  let stdio = options.capture ? ["ignore", "pipe", "inherit"] : (options.stdio ?? "inherit");
  if (options.outputFile) {
    outputFd = openSync(options.outputFile, "wx", 0o600);
    stdio = ["ignore", outputFd, "inherit"];
  } else if (options.inputFile) {
    inputFd = openSync(options.inputFile, "r");
    stdio = [inputFd, "inherit", "inherit"];
  } else if (options.input) {
    stdio = ["pipe", "inherit", "inherit"];
  }
  let result;
  try {
    result = spawnSync(command, args, {
      cwd: projectRoot,
      stdio,
      input: options.input
    });
  } finally {
    if (outputFd !== undefined) closeSync(outputFd);
    if (inputFd !== undefined) closeSync(inputFd);
  }
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} exited with status ${result.status ?? "unknown"}.`);
  return options.capture ? result.stdout : Buffer.alloc(0);
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export function confirmRestore(prompt, { input = process.stdin, output = process.stderr } = {}) {
  output.write(prompt);
  return new Promise((resolvePromise, rejectPromise) => {
    input.setEncoding("utf8");
    const finish = (answer, error) => {
      input.off("data", onData);
      input.off("end", onEnd);
      input.off("error", onError);
      input.pause();
      if (error) rejectPromise(error);
      else resolvePromise(answer);
    };
    const onData = (value) => finish(value.trim() === "RESTORE");
    const onEnd = () => finish(false);
    const onError = (error) => finish(false, error);
    input.once("data", onData);
    input.once("end", onEnd);
    input.once("error", onError);
    input.resume();
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runOperator(parseArgs(process.argv.slice(2))).catch((error) => {
    process.stderr.write(`Jarvis operator command failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
