import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MIGRATION_FILE = /^(\d{4})_[a-z0-9_]+\.sql$/u;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(parseOptions(process.argv.slice(2)));
}

export function parseOptions(args) {
  const option = (name) => {
    const index = args.indexOf(name);
    if (index === -1) return undefined;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
    return value;
  };
  if (args.includes("--help")) return { help: true };

  const known = new Set(["--env-file", "--compose-file", "--project-name"]);
  for (const arg of args) {
    if (arg.startsWith("--") && !known.has(arg)) throw new Error(`Unknown option: ${arg}`);
  }
  return {
    envFile: option("--env-file") ?? "deploy/compose/.env.production",
    composeFile: option("--compose-file") ?? "deploy/compose/compose.production.yml",
    projectName: option("--project-name") ?? "jarvis"
  };
}

export function orderedMigrationFiles(entries) {
  return entries
    .filter((entry) => MIGRATION_FILE.test(entry))
    .sort((left, right) => left.localeCompare(right, "en"));
}

export function pendingMigrationFiles(files, currentMigration) {
  return files.filter((file) => Number(MIGRATION_FILE.exec(file)?.[1]) > currentMigration);
}

export function resolveCurrentMigration({
  hasApplicationSchema,
  hasMigrationLedger,
  migrationNumber,
  latestMigration
}) {
  if (!hasApplicationSchema) return 0;
  if (!hasMigrationLedger) throw unsupportedDatabaseError();
  if (!/^\d+$/u.test(migrationNumber)) {
    throw unsupportedDatabaseError("The public migration ledger is empty or invalid.");
  }
  const currentMigration = Number(migrationNumber);
  if (currentMigration < 1) throw unsupportedDatabaseError();
  if (currentMigration > latestMigration) {
    throw new Error(
      `Database migration ${currentMigration} is newer than this checkout supports (${latestMigration}).`
    );
  }
  return currentMigration;
}

async function main(options) {
  if (options.help) {
    process.stdout.write(
      "Usage: node scripts/migrations/apply-database-migrations.mjs [options]\n\n" +
        "Applies pending reviewed migrations in one transaction and verifies the schema ledger.\n\n" +
        "Options:\n" +
        "  --env-file <path>      Compose environment file\n" +
        "  --compose-file <path>  Compose file\n" +
        "  --project-name <name>  Compose project name (default: jarvis)\n"
    );
    return;
  }

  const projectRoot = resolve(new URL("../..", import.meta.url).pathname);
  const migrationsDirectory = resolve(projectRoot, "deploy/migrations");
  const files = orderedMigrationFiles(await readdir(migrationsDirectory));
  if (files.length === 0) throw new Error(`No migrations found in ${migrationsDirectory}.`);
  const latestMigration = Number(MIGRATION_FILE.exec(files.at(-1))?.[1]);

  const compose = [
    "compose",
    "--project-name",
    options.projectName,
    "--env-file",
    resolve(projectRoot, options.envFile),
    "-f",
    resolve(projectRoot, options.composeFile)
  ];
  // The command is also used during first-time host setup, before the rest of
  // the stack exists. PostgreSQL's health check includes completion of its
  // own initialization scripts.
  run("docker", [...compose, "up", "--detach", "--wait", "--remove-orphans", "brain-db"]);
  const hasApplicationSchema =
    capture("docker", [
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
      "SELECT to_regnamespace('brain_core') IS NOT NULL"
    ]).trim() === "t";
  let currentMigration;
  if (hasApplicationSchema) {
    const hasMigrationLedger =
      capture("docker", [
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
        "SELECT to_regclass('brain_core.schema_metadata') IS NOT NULL"
      ]).trim() === "t";
    const currentMigrationValue = hasMigrationLedger ? readMigrationNumber(compose) : "";
    currentMigration = resolveCurrentMigration({
      hasApplicationSchema,
      hasMigrationLedger,
      migrationNumber: currentMigrationValue,
      latestMigration
    });
    if (currentMigration === latestMigration) {
      process.stdout.write(`Database schema is current at migration ${latestMigration}.\n`);
      return;
    }
  } else currentMigration = 0;

  const pendingFiles = pendingMigrationFiles(files, currentMigration);
  const migrationInput = (
    await Promise.all(
      pendingFiles.map(async (file) =>
        [`-- ${file}`, await readFile(resolve(migrationsDirectory, file), "utf8")].join("\n")
      )
    )
  ).join("\n\n");

  run(
    "docker",
    [
      ...compose,
      "exec",
      "-T",
      "brain-db",
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-1",
      "-U",
      "brain",
      "-d",
      "brain"
    ],
    migrationInput
  );

  const result = readMigrationNumber(compose);
  if (Number(result) !== latestMigration) {
    throw new Error(
      `Database migration verification failed: expected ${latestMigration}, received ${result || "no value"}.`
    );
  }
  process.stdout.write(`Database schema is current at migration ${latestMigration}.\n`);
}

function unsupportedDatabaseError(detail) {
  const prefix = detail ? `${detail} ` : "";
  return new Error(
    `${prefix}This database predates the public migration baseline or has an unknown schema. ` +
      "Back up any data you need, remove the existing Jarvis PostgreSQL volume, and run setup again. " +
      "In-place upgrades from private pre-release databases are not supported."
  );
}

function readMigrationNumber(compose) {
  return capture("docker", [
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
    "SELECT migration_number FROM brain_core.schema_metadata WHERE singleton = true"
  ]).trim();
}

function run(command, args, input) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    input,
    stdio: ["pipe", "inherit", "inherit"]
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed.`);
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"]
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed.`);
  return result.stdout ?? "";
}
