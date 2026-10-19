import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const RELEASE_ARTIFACTS = Object.freeze({
  catalog: "platform-catalog.v2.json",
  runtimeManifest: "runtime-manifest.json",
  modelCatalog: "model-catalog.json"
});

export async function stageRelease(input) {
  const sources = {
    catalog: resolve(input.catalogPath),
    runtimeManifest: resolve(input.runtimeManifestPath),
    modelCatalog: resolve(input.modelCatalogPath)
  };
  const [catalog, runtimeManifest, modelCatalog] = await Promise.all([
    readJson(sources.catalog),
    readJson(sources.runtimeManifest),
    readJson(sources.modelCatalog)
  ]);
  const controlPlaneImageId = requireImageId(input.controlPlaneImageId, "control plane image");
  const runtimeClassImageIds = runtimeImagesFromCatalog(catalog);
  assertCatalogDigest(catalog);
  assertRuntimeManifestLinkage(runtimeManifest, runtimeClassImageIds);
  assertModelCatalogLinkage(catalog, modelCatalog);
  const databaseCompatibility = validateDatabaseCompatibility(input.databaseCompatibility);

  const artifacts = {};
  for (const [name, source] of Object.entries(sources)) {
    artifacts[name] = {
      path: RELEASE_ARTIFACTS[name],
      sha256: digest(await readFile(source))
    };
  }
  const releaseContent = {
    schemaVersion: 1,
    pluginApiSchemaRevision: 1,
    gitRevision: requireGitRevision(input.gitRevision),
    databaseCompatibility,
    catalogDigest: catalog.digest,
    modelCatalogDigest: artifacts.modelCatalog.sha256,
    artifacts,
    imageIds: { controlPlane: controlPlaneImageId, runtimeClasses: runtimeClassImageIds }
  };
  const id = `release-${digest(stableJson(releaseContent)).slice("sha256:".length, 24)}`;
  const release = { ...releaseContent, id };
  const releaseRoot = resolve(input.releaseRoot);
  await mkdir(releaseRoot, { recursive: true });
  const temporary = join(releaseRoot, `.${id}.${process.pid}.${randomUUID()}.tmp`);
  const target = join(releaseRoot, id);
  await mkdir(temporary);
  try {
    for (const [name, source] of Object.entries(sources)) {
      await cp(source, join(temporary, RELEASE_ARTIFACTS[name]), {
        dereference: true,
        errorOnExist: true,
        force: false
      });
    }
    await writeJson(join(temporary, "release.json"), release);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  return { ...release, directory: target };
}

export async function verifyRelease(releaseDirectory, options = {}) {
  const directory = resolve(releaseDirectory);
  const release = validateReleaseShape(await readJson(join(directory, "release.json")));
  for (const [name, expectedPath] of Object.entries(RELEASE_ARTIFACTS)) {
    const artifact = release.artifacts[name];
    if (artifact.path !== expectedPath || basename(artifact.path) !== artifact.path) {
      throw new Error(`Unsafe release artifact path: ${artifact.path}.`);
    }
    const artifactPath = join(directory, artifact.path);
    const stat = await lstat(artifactPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Release artifact must be a regular file: ${artifact.path}.`);
    }
    if (digest(await readFile(artifactPath)) !== artifact.sha256) {
      throw new Error(`Release artifact digest mismatch: ${artifact.path}.`);
    }
  }
  const catalog = await readJson(join(directory, release.artifacts.catalog.path));
  const runtimeManifest = await readJson(join(directory, release.artifacts.runtimeManifest.path));
  const modelCatalog = await readJson(join(directory, release.artifacts.modelCatalog.path));
  assertCatalogDigest(catalog);
  if (release.catalogDigest !== catalog.digest) throw new Error("Release catalog digest mismatch.");
  if (release.modelCatalogDigest !== release.artifacts.modelCatalog.sha256) {
    throw new Error("Release model catalog digest mismatch.");
  }
  const runtimeImages = runtimeImagesFromCatalog(catalog);
  if (stableJson(runtimeImages) !== stableJson(release.imageIds.runtimeClasses)) {
    throw new Error("Release runtime image IDs do not match the platform catalog.");
  }
  assertRuntimeManifestLinkage(runtimeManifest, runtimeImages);
  assertModelCatalogLinkage(catalog, modelCatalog);
  const agents = new Set((catalog.agents ?? []).map((agent) => agent.id));
  for (const agentId of options.referencedAgentIds ?? []) {
    if (!agents.has(agentId)) {
      throw new Error(`Release catalog does not contain referenced agent: ${agentId}.`);
    }
  }
  if (options.currentMigration !== undefined) {
    const { minimumMigration, maximumMigration } = release.databaseCompatibility;
    if (
      !Number.isInteger(options.currentMigration) ||
      (!options.allowPendingMigrations && options.currentMigration < minimumMigration) ||
      options.currentMigration > maximumMigration
    ) {
      throw new Error(
        `Database migration ${options.currentMigration} is incompatible with release.`
      );
    }
  }
  const { id: _id, ...content } = release;
  const expectedId = `release-${digest(stableJson(content)).slice("sha256:".length, 24)}`;
  if (release.id !== expectedId) throw new Error("Release identity digest mismatch.");
  return release;
}

export async function activateRelease(releaseDirectory, options) {
  if (!options || typeof options.deploy !== "function") {
    throw new Error("Release activation requires an explicit deployment adapter.");
  }
  requireDatabasePreflight(options);
  const release = await verifyRelease(releaseDirectory, {
    ...options,
    allowPendingMigrations: true
  });
  const stateRoot = resolve(options.stateRoot);
  await mkdir(stateRoot, { recursive: true });
  const currentPath = join(stateRoot, "current.json");
  const previousPath = join(stateRoot, "previous.json");
  const current = await readOptionalJson(currentPath);
  await options.deploy(release, resolve(releaseDirectory));
  await writeJsonAtomic(currentPath, deploymentRecord(release, resolve(releaseDirectory)));
  if (current) await writeJsonAtomic(previousPath, current);
  return release;
}

/** Owner-facing one-step path: build an immutable candidate, verify it, and deploy it. */
export async function deployRelease(input, options) {
  const candidate = await stageRelease(input);
  return activateRelease(candidate.directory, options);
}

export async function rollbackRelease(options) {
  if (!options || typeof options.deploy !== "function") {
    throw new Error("Release rollback requires an explicit deployment adapter.");
  }
  requireDatabasePreflight(options);
  const stateRoot = resolve(options.stateRoot);
  const currentPath = join(stateRoot, "current.json");
  const previousPath = join(stateRoot, "previous.json");
  const current = await readOptionalJson(currentPath);
  const previous = await readOptionalJson(previousPath);
  if (!previous) throw new Error("No previous release is available for rollback.");
  const release = await verifyRelease(previous.directory, options);
  if (requireGitRevision(options.gitRevision) !== release.gitRevision) {
    throw new Error(
      `Checked-out Git revision ${options.gitRevision} does not match previous deployment ${release.gitRevision}.`
    );
  }
  await options.deploy(release, previous.directory);
  await writeJsonAtomic(currentPath, previous);
  if (current) await writeJsonAtomic(previousPath, current);
  return release;
}

/** Restores the recorded previous deployment set after compatibility preflight. */
export const recoverPreviousDeployment = rollbackRelease;

function deploymentRecord(release, directory) {
  return {
    releaseId: release.id,
    directory,
    gitRevision: release.gitRevision,
    catalogDigest: release.catalogDigest,
    modelCatalogDigest: release.modelCatalogDigest,
    imageIds: release.imageIds
  };
}

function validateReleaseShape(value) {
  if (
    value?.schemaVersion !== 1 ||
    value.pluginApiSchemaRevision !== 1 ||
    typeof value.id !== "string" ||
    !/^[a-f0-9]{40}$/u.test(value.gitRevision ?? "") ||
    !SHA256.test(value.catalogDigest ?? "") ||
    !SHA256.test(value.modelCatalogDigest ?? "") ||
    typeof value.artifacts !== "object" ||
    typeof value.imageIds !== "object"
  ) {
    throw new Error("Invalid plugin platform release manifest.");
  }
  validateDatabaseCompatibility(value.databaseCompatibility);
  requireImageId(value.imageIds.controlPlane, "control plane image");
  for (const id of ["base", "isolated", "browser"]) {
    requireImageId(value.imageIds.runtimeClasses?.[id], `${id} runtime image`);
  }
  for (const name of Object.keys(RELEASE_ARTIFACTS)) {
    const artifact = value.artifacts[name];
    if (!artifact || typeof artifact.path !== "string" || !SHA256.test(artifact.sha256 ?? "")) {
      throw new Error(`Invalid release artifact metadata: ${name}.`);
    }
  }
  return value;
}

function assertCatalogDigest(catalog) {
  if (catalog?.schemaVersion !== 2 || !SHA256.test(catalog.digest ?? "")) {
    throw new Error("Invalid platform catalog in release.");
  }
  const { digest: _digest, ...content } = catalog;
  if (digest(stableJson(content)) !== catalog.digest) {
    throw new Error("Platform catalog canonical digest mismatch.");
  }
}

function runtimeImagesFromCatalog(catalog) {
  const images = Object.fromEntries(
    (catalog.runtimeClasses ?? []).map(({ id, image }) => [id, requireImageId(image, id)])
  );
  for (const id of ["base", "isolated", "browser"]) {
    if (!images[id]) throw new Error(`Platform catalog lacks runtime class: ${id}.`);
  }
  return {
    base: images.base,
    isolated: images.isolated,
    browser: images.browser
  };
}

function assertRuntimeManifestLinkage(runtimeManifest, runtimeImages) {
  const current = runtimeManifest?.currentRuntime;
  if (
    current?.imageId !== runtimeImages.base ||
    current.imageId !== runtimeImages.isolated ||
    current.runtimeImageIds?.browser !== runtimeImages.browser
  ) {
    throw new Error("Runtime manifest image IDs do not match the platform catalog.");
  }
}

function assertModelCatalogLinkage(catalog, modelCatalog) {
  if (
    !modelCatalog?.providers ||
    typeof modelCatalog.providers !== "object" ||
    Array.isArray(modelCatalog.providers)
  ) {
    throw new Error("Invalid release model catalog.");
  }
  const available = new Set();
  for (const [providerId, provider] of Object.entries(modelCatalog.providers)) {
    if (!Array.isArray(provider?.models)) {
      throw new Error(`Invalid release model provider: ${providerId}.`);
    }
    for (const model of provider.models) {
      if (typeof model?.id !== "string" || model.id.length === 0) {
        throw new Error(`Invalid release model for provider: ${providerId}.`);
      }
      available.add(`${providerId}\0${model.id}`);
    }
  }
  for (const agent of catalog.agents ?? []) {
    if (agent.model && !available.has(`${agent.model.providerId}\0${agent.model.modelId}`)) {
      throw new Error(
        `Release model catalog lacks ${agent.model.providerId}/${agent.model.modelId} for agent ${agent.id}.`
      );
    }
  }
}

function validateDatabaseCompatibility(value) {
  const minimumMigration = value?.minimumMigration;
  const maximumMigration = value?.maximumMigration;
  if (
    !Number.isInteger(minimumMigration) ||
    !Number.isInteger(maximumMigration) ||
    minimumMigration < 1 ||
    maximumMigration < minimumMigration
  ) {
    throw new Error("Invalid database compatibility range.");
  }
  return { minimumMigration, maximumMigration };
}

function requireImageId(value, label) {
  if (!SHA256.test(value ?? "")) throw new Error(`Invalid immutable ${label} ID.`);
  return value;
}

function requireGitRevision(value) {
  if (!/^[a-f0-9]{40}$/u.test(value ?? "")) {
    throw new Error("A deployment requires the reviewed Git commit revision.");
  }
  return value;
}

function requireDatabasePreflight(options) {
  if (!Number.isInteger(options.currentMigration) || !Array.isArray(options.referencedAgentIds)) {
    throw new Error(
      "Release activation requires the current migration and durable referenced-agent preflight."
    );
  }
}

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readOptionalJson(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeJson(temporary, value);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function option(args, name) {
  const index = args.indexOf(name);
  const value = index < 0 ? undefined : args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function optionalOption(args, name) {
  return args.includes(name) ? option(args, name) : undefined;
}

async function composeDeploymentOptions(args) {
  const { createComposePluginReleaseDeployer } = await import(
    "./compose-plugin-release-deployer.mjs"
  );
  const optionalTargets = {
    ...(optionalOption(args, "--model-catalog-target")
      ? { modelCatalog: option(args, "--model-catalog-target") }
      : {})
  };
  const deployer = createComposePluginReleaseDeployer({
    artifactTargets: {
      catalog: option(args, "--catalog-target"),
      runtimeManifest: option(args, "--runtime-manifest-target"),
      ...optionalTargets
    },
    ...(optionalOption(args, "--project-root")
      ? { projectRoot: option(args, "--project-root") }
      : {}),
    ...(optionalOption(args, "--project-name")
      ? { projectName: option(args, "--project-name") }
      : {}),
    ...(optionalOption(args, "--env-file") ? { envFile: option(args, "--env-file") } : {}),
    ...(optionalOption(args, "--compose-file")
      ? { composeFile: option(args, "--compose-file") }
      : {}),
    ...(optionalOption(args, "--backup-directory")
      ? { backupDirectory: option(args, "--backup-directory") }
      : {})
  });
  const preflight = await deployer.preflight();
  return {
    stateRoot: option(args, "--state-root"),
    gitRevision: currentGitRevision(optionalOption(args, "--project-root")),
    currentMigration: preflight.currentMigration,
    referencedAgentIds: preflight.referencedAgentIds,
    deploy: deployer.deploy
  };
}

async function runCli() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "deploy") {
    const deploymentOptions = await composeDeploymentOptions(args);
    const release = await deployRelease(
      {
        catalogPath: option(args, "--catalog"),
        runtimeManifestPath: option(args, "--runtime-manifest"),
        modelCatalogPath: option(args, "--model-catalog"),
        controlPlaneImageId: option(args, "--control-image"),
        gitRevision: deploymentOptions.gitRevision,
        databaseCompatibility: {
          minimumMigration: Number(option(args, "--minimum-migration")),
          maximumMigration: Number(option(args, "--maximum-migration"))
        },
        releaseRoot: option(args, "--release-root")
      },
      deploymentOptions
    );
    process.stdout.write(`Deployed ${release.id} from Git ${release.gitRevision}.\n`);
    return;
  }
  if (command === "recover") {
    const release = await recoverPreviousDeployment(await composeDeploymentOptions(args));
    process.stdout.write(`Recovered ${release.id} from Git ${release.gitRevision}.\n`);
    return;
  }
  throw new Error(
    "Usage: plugin-release <deploy|recover>. Run with the command-specific options documented in docs/development/plugin-release.md."
  );
}

function currentGitRevision(projectRoot) {
  const root = resolve(projectRoot ?? fileURLToPath(new URL("../..", import.meta.url)));
  const dirty = execFileSync(
    "git",
    ["-C", root, "status", "--porcelain", "--untracked-files=all"],
    { encoding: "utf8" }
  ).trim();
  if (dirty) throw new Error("Platform deployment requires a clean reviewed Git checkout.");
  return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli();
