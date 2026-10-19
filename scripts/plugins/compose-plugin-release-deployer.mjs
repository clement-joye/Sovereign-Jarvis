import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const IMAGE_ID = /^(?:[a-z0-9][a-z0-9./_-]*@)?sha256:[a-f0-9]{64}$/u;
const CATALOG_CONSUMERS = Object.freeze([
  "brain-control",
  "runtime-provisioner",
  "matrix-gateway",
  "brain-worker",
  "brain-delegation-worker"
]);
const QUIESCED_SERVICES = Object.freeze([...CATALOG_CONSUMERS, "scheduler"]);

// Keep this SQL identical in scope to PostgresDurableAgentReferenceRepository.
export const durableAgentReferencesSql = `SELECT DISTINCT agent_id FROM (
  SELECT default_agent AS agent_id FROM brain_core.workspaces
  UNION SELECT agent_id FROM brain_core.session_bindings
  UNION SELECT agent_id FROM brain_core.thread_agent_selections
  UNION SELECT agent_id FROM brain_core.scheduled_jobs
    WHERE enabled = true AND deleted_at IS NULL
  UNION SELECT agent_id FROM brain_core.agent_runs
    WHERE status IN ('queued', 'running')
  UNION SELECT delegation_grants.child_agent_id AS agent_id
    FROM brain_core.delegation_grants
    INNER JOIN brain_core.agent_runs
      ON brain_core.agent_runs.id = brain_core.delegation_grants.parent_run_id
    WHERE brain_core.agent_runs.status IN ('queued', 'running')
      AND brain_core.delegation_grants.expires_at > now()
  UNION SELECT agent_id FROM brain_core.action_proposals
    WHERE status IN ('proposed', 'approved')
  UNION SELECT unnest(enabled_agents) AS agent_id FROM brain_core.workspace_plugin_bindings
  UNION SELECT payload->>'agentId' AS agent_id FROM brain_jobs.jobs
    WHERE status IN ('pending', 'leased', 'running', 'retry_wait')
) refs WHERE agent_id IS NOT NULL ORDER BY agent_id`;

export const schemaPreflightSql = `SELECT json_build_object(
  'brainCoreSchema', EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'brain_core'),
  'hasMigrationLedger', to_regclass('brain_core.schema_metadata') IS NOT NULL,
  'hasDynamicAgentIdentifiers', to_regprocedure('brain_core.valid_agent_identifiers(text[])') IS NOT NULL
)::text`;

export const schemaMigrationSql =
  "SELECT migration_number FROM brain_core.schema_metadata WHERE singleton = true";

/**
 * Creates the adapter passed to activateRelease()/rollbackRelease(). Paths in
 * artifactTargets are host paths mounted by Compose, never container paths.
 */
export function createComposePluginReleaseDeployer(options) {
  const config = normalizeOptions(options);
  const compose = (...arguments_) => ["compose", ...config.composeArgs, ...arguments_];
  const runCompose = (arguments_, runOptions = {}) =>
    run(config.commandRunner, "docker", compose(...arguments_), runOptions);

  async function preflight() {
    const configuredImageReference = composeControlPlaneImageReference(
      runCompose(["config", "--format", "json"])
    );
    const configuredImage = imageDigest(
      run(config.commandRunner, "docker", [
        "image",
        "inspect",
        configuredImageReference,
        "--format",
        "{{.Id}}"
      ]).stdout.trim()
    );
    const metadata = parseSingleJson(
      runCompose([
        "exec",
        "-T",
        config.databaseService,
        "psql",
        "-At",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        config.databaseUser,
        "-d",
        config.databaseName,
        "-c",
        schemaPreflightSql
      ]).stdout,
      "database schema preflight"
    );
    if (!metadata.brainCoreSchema) {
      throw new Error("Database schema preflight returned invalid metadata.");
    }
    let currentMigration;
    if (metadata.hasMigrationLedger) {
      const migrationOutput = runCompose([
        "exec",
        "-T",
        config.databaseService,
        "psql",
        "-At",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        config.databaseUser,
        "-d",
        config.databaseName,
        "-c",
        schemaMigrationSql
      ]).stdout.trim();
      currentMigration = Number(migrationOutput);
    }
    if (!Number.isInteger(currentMigration) || currentMigration < 1) {
      throw new Error("Database migration ledger is absent or invalid.");
    }
    const referencedAgentIds = outputLines(
      runCompose([
        "exec",
        "-T",
        config.databaseService,
        "psql",
        "-At",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        config.databaseUser,
        "-d",
        config.databaseName,
        "-c",
        durableAgentReferencesSql
      ]).stdout
    );
    return {
      configuredControlPlaneImage: configuredImage,
      currentMigration,
      referencedAgentIds
    };
  }

  async function deploy(release, releaseDirectory) {
    const before = await preflight();
    if (
      imageDigest(before.configuredControlPlaneImage) !== imageDigest(release.imageIds.controlPlane)
    ) {
      throw new Error(
        `Configured brain-control image ${before.configuredControlPlaneImage} does not match release control-plane image ${release.imageIds.controlPlane}.`
      );
    }
    const backup = join(config.backupDirectory, `${release.id}-${Date.now()}-${randomUUID()}`);
    await mkdir(backup, { recursive: true });
    const backups = await backupTargets(config.artifactTargets, backup);
    let stopped = false;
    try {
      const dump = runCompose([
        "exec",
        "-T",
        config.databaseService,
        "pg_dump",
        "--username",
        config.databaseUser,
        "--dbname",
        config.databaseName
      ]).stdout;
      await writeAtomic(join(backup, "brain-db.sql"), dump);
      await publishTargets(release, releaseDirectory, config.artifactTargets);
      runCompose(["stop", ...QUIESCED_SERVICES]);
      stopped = true;
      await applyMigrations(
        config,
        runCompose,
        before.currentMigration,
        release.databaseCompatibility.maximumMigration
      );
      const after = await preflight();
      if (
        after.currentMigration < release.databaseCompatibility.minimumMigration ||
        after.currentMigration > release.databaseCompatibility.maximumMigration
      ) {
        throw new Error(
          `Database migration ${after.currentMigration} is incompatible after deployment migrations.`
        );
      }
      runCompose([
        "up",
        "--detach",
        "--no-build",
        "--wait",
        "--force-recreate",
        ...CATALOG_CONSUMERS
      ]);
      runCompose(["start", "scheduler"]);
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error(String(caught));
      const restorationErrors = [];
      try {
        await restoreTargets(backups);
      } catch (restoreError) {
        restorationErrors.push(restoreError);
      }
      if (stopped) {
        try {
          runCompose(["up", "--detach", "--no-build"]);
        } catch (restartError) {
          restorationErrors.push(restartError);
        }
      }
      if (restorationErrors.length) {
        error.message += ` Rollback also encountered: ${restorationErrors.map(String).join("; ")}`;
      }
      throw error;
    }
  }

  return { deploy, preflight };
}

function normalizeOptions(options = {}) {
  if (!options.artifactTargets?.catalog || !options.artifactTargets?.runtimeManifest) {
    throw new Error("artifactTargets.catalog and artifactTargets.runtimeManifest are required.");
  }
  const root = resolve(options.projectRoot ?? new URL("../..", import.meta.url).pathname);
  return {
    commandRunner: options.commandRunner ?? productionCommandRunner,
    composeArgs: [
      "--project-name",
      options.projectName ?? "jarvis",
      "--env-file",
      resolve(root, options.envFile ?? "deploy/compose/.env.production"),
      "-f",
      resolve(root, options.composeFile ?? "deploy/compose/compose.production.yml")
    ],
    artifactTargets: Object.fromEntries(
      Object.entries(options.artifactTargets).map(([name, path]) => [name, resolve(path)])
    ),
    backupDirectory: resolve(options.backupDirectory ?? join(root, ".release-backups")),
    migrationsDirectory: resolve(options.migrationsDirectory ?? join(root, "deploy/migrations")),
    databaseService: options.databaseService ?? "brain-db",
    databaseUser: options.databaseUser ?? "brain",
    databaseName: options.databaseName ?? "brain"
  };
}

async function backupTargets(targets, backupDirectory) {
  const backups = [];
  for (const [name, target] of Object.entries(targets)) {
    const destination = join(backupDirectory, `${name}-${basename(target)}`);
    await cp(target, destination, { dereference: false, errorOnExist: true, force: false });
    backups.push({ target, destination });
  }
  return backups;
}

async function publishTargets(release, directory, targets) {
  for (const [name, target] of Object.entries(targets)) {
    const artifact = release.artifacts[name];
    if (!artifact || basename(artifact.path) !== artifact.path) {
      throw new Error(`Release has no safe artifact for target ${name}.`);
    }
    await copyAtomic(join(directory, artifact.path), target);
  }
}

async function restoreTargets(backups) {
  for (const { target, destination } of backups) await copyAtomic(destination, target);
}

async function applyMigrations(config, runCompose, currentMigration, maximumMigration) {
  const files = (await readdir(config.migrationsDirectory))
    .filter((file) => /^(\d+)_.*\.sql$/u.test(file))
    .sort((left, right) => left.localeCompare(right, "en"));
  for (const file of files) {
    const migration = Number(/^\d+/u.exec(file)[0]);
    if (migration <= currentMigration || migration > maximumMigration) continue;
    runCompose(
      [
        "exec",
        "-T",
        config.databaseService,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        config.databaseUser,
        "-d",
        config.databaseName
      ],
      { input: await readFile(join(config.migrationsDirectory, file), "utf8") }
    );
  }
}

async function copyAtomic(source, target) {
  await mkdir(dirname(target), { recursive: true });
  const temporary = join(
    dirname(target),
    `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    await cp(source, temporary, { dereference: false, errorOnExist: true, force: false });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function writeAtomic(target, content) {
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { mode: 0o600 });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function composeControlPlaneImageReference(result) {
  const image = parseSingleJson(result.stdout, "docker compose config")?.services?.["brain-control"]
    ?.image;
  if (typeof image !== "string" || image.length === 0) {
    throw new Error("Compose brain-control image reference is missing.");
  }
  return image;
}

function imageDigest(image) {
  const digest = image.slice(image.indexOf("sha256:"));
  if (!IMAGE_ID.test(digest)) throw new Error("Control-plane image has no immutable image ID.");
  return digest;
}

function parseSingleJson(output, label) {
  try {
    return JSON.parse(output.trim());
  } catch {
    throw new Error(`Invalid ${label} JSON output.`);
  }
}
function outputLines(output) {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}
function run(runner, command, args, options) {
  const result = runner(command, args, options);
  if (!result || result.status !== 0)
    throw new Error(`${command} ${args.join(" ")} failed: ${result?.stderr ?? ""}`.trim());
  return { ...result, stdout: result.stdout ?? "" };
}

export function productionCommandRunner(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: [options.input === undefined ? "inherit" : "pipe", "pipe", "pipe"],
    input: options.input
  });
}
