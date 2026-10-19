import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  PluginManifestV2Schema,
  type PlatformCatalogV2
} from "@second-brain/contracts/platform-catalog";

import {
  installedRuntimeClassesV2,
  INSTALLED_LOCAL_TOOL_FACTORY_IDS_V2,
  INSTALLED_PLUGIN_BROKER_PROVIDER_IDS_V2,
  INSTALLED_PLUGIN_MANIFESTS_V2,
  INSTALLED_REVIEWED_MODELS_V2,
  type InstalledRuntimeImagePinsV2
} from "@second-brain/installed-plugins/catalog";
import { parsePlatformCatalogV2Artifact } from "../artifacts/platform-catalog-artifact-loader.js";
import {
  compilePlatformCatalogV2,
  type PluginPackageV2
} from "../compiler/platform-catalog-compiler.js";

const PLUGIN_RESOURCES_PATTERN = /^plugins\/([a-z][a-z0-9-]{0,63})\/resources\/(.+)$/;
const AGENT_PLUGIN_LOCK_PATH = "plugins/agents.lock.json";
const REVIEWED_PLUGIN_MANIFESTS_V2 = INSTALLED_PLUGIN_MANIFESTS_V2;

export interface CorePlatformCatalogReleaseInput {
  /** Repository root containing the reviewed core profile resources. */
  repoRoot: string;
  /** Operator-resolved immutable runtime image IDs or digest references. */
  runtimeImages: InstalledRuntimeImagePinsV2;
}

/**
 * Compiles the catalog exclusively from installed-plugin resources known to
 * Git. Untracked files and legacy profile copies cannot enter a release digest.
 */
export async function compileCorePlatformCatalogRelease(
  input: CorePlatformCatalogReleaseInput
): Promise<Readonly<PlatformCatalogV2>> {
  const repoRoot = resolve(input.repoRoot);
  const trackedPaths = listTrackedProfilePaths(repoRoot);
  const manifests = [
    ...REVIEWED_PLUGIN_MANIFESTS_V2,
    ...(await loadLockedAgentManifests(repoRoot, trackedPaths))
  ];
  const filesByPlugin = new Map<string, Map<string, Uint8Array>>();

  for (const repositoryPath of trackedPaths) {
    const pluginResource = pluginResourcePath(repositoryPath);
    if (!pluginResource) continue;
    const files = filesByPlugin.get(pluginResource.pluginId) ?? new Map<string, Uint8Array>();
    if (files.has(pluginResource.path)) {
      throw new Error(
        `Multiple tracked plugin resources resolve to ${pluginResource.pluginId}/${pluginResource.path}.`
      );
    }

    const sourcePath = join(repoRoot, ...repositoryPath.split("/"));
    const stat = await lstat(sourcePath).catch((error: NodeJS.ErrnoException) => {
      // `git ls-files` includes tracked paths deleted in the working tree. A
      // release compiled during an intentional removal must omit those paths.
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!stat) continue;
    if (!stat.isFile()) {
      throw new Error(`Tracked core resource must be a regular file: ${repositoryPath}.`);
    }
    files.set(pluginResource.path, await readFile(sourcePath));
    filesByPlugin.set(pluginResource.pluginId, files);
  }

  // Git cannot represent an intentionally empty directory. Preserve that
  // reviewed manifest state with an explicit virtual marker, without reading
  // or trusting any untracked files that happen to exist below the root.
  for (const manifest of manifests) {
    const files = filesByPlugin.get(manifest.id) ?? new Map<string, Uint8Array>();
    for (const skillRoot of manifest.agents.flatMap((agent) => agent.skillPaths)) {
      if (![...files.keys()].some((path) => path.startsWith(`${skillRoot}/`))) {
        files.set(skillRoot, new Uint8Array());
      }
    }
    filesByPlugin.set(manifest.id, files);
  }

  return compilePlatformCatalogV2({
    plugins: manifests.map((manifest) => ({
      manifest,
      // Every tracked package resource contributes to the plugin and catalog
      // digest, including transitive imports beside an executable entrypoint.
      files: filesByPlugin.get(manifest.id) ?? new Map()
    })),
    runtimeClasses: installedRuntimeClassesV2(input.runtimeImages),
    reviewedModels: [...INSTALLED_REVIEWED_MODELS_V2],
    localToolFactoryIds: [...INSTALLED_LOCAL_TOOL_FACTORY_IDS_V2],
    brokerProviderIds: [...INSTALLED_PLUGIN_BROKER_PROVIDER_IDS_V2]
  });
}

/** Pure compiler entry point for reviewed release inputs and deterministic tests. */
export function compileCorePlatformCatalogReleaseFromResources(
  runtimeImages: InstalledRuntimeImagePinsV2,
  files: PluginPackageV2["files"]
): Readonly<PlatformCatalogV2> {
  return compilePlatformCatalogV2({
    plugins: REVIEWED_PLUGIN_MANIFESTS_V2.map((manifest) => ({
      manifest,
      files: filterResourcesForManifest(manifest, files)
    })),
    runtimeClasses: installedRuntimeClassesV2(runtimeImages),
    reviewedModels: [...INSTALLED_REVIEWED_MODELS_V2],
    localToolFactoryIds: [...INSTALLED_LOCAL_TOOL_FACTORY_IDS_V2],
    brokerProviderIds: [...INSTALLED_PLUGIN_BROKER_PROVIDER_IDS_V2]
  });
}

/** Stable release representation; no timestamps or host-specific metadata. */
export function serializePlatformCatalogRelease(catalog: Readonly<PlatformCatalogV2>): string {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

/** Compiles and atomically replaces a catalog release artifact. */
export async function writeCorePlatformCatalogRelease(
  outputPath: string,
  input: CorePlatformCatalogReleaseInput
): Promise<Readonly<PlatformCatalogV2>> {
  const catalog = await compileCorePlatformCatalogRelease(input);
  await writePlatformCatalogReleaseArtifact(outputPath, catalog);
  return catalog;
}

/** Atomically writes an already-compiled catalog artifact. */
export async function writePlatformCatalogReleaseArtifact(
  outputPath: string,
  catalog: Readonly<PlatformCatalogV2>
): Promise<void> {
  const target = resolve(outputPath);
  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  const temporary = join(parent, `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, serializePlatformCatalogRelease(catalog), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o644
    });
    await chmod(temporary, 0o644);
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch((cleanupError: NodeJS.ErrnoException) => {
      if (cleanupError.code !== "ENOENT") throw cleanupError;
    });
    throw error;
  }
}

/**
 * Verifies both artifact integrity and reproducibility from the current tracked
 * release inputs. Alternate formatting or stale source/image inputs fail.
 */
export async function verifyCorePlatformCatalogRelease(
  artifactPath: string,
  input: CorePlatformCatalogReleaseInput
): Promise<Readonly<PlatformCatalogV2>> {
  const actual = await readFile(resolve(artifactPath), "utf8");
  const loaded = parsePlatformCatalogV2Artifact(actual).catalog;
  const expected = await compileCorePlatformCatalogRelease(input);
  verifyReleaseBytes(actual, loaded, expected);
  return loaded;
}

/** Verifies an artifact against an already-compiled expected release. */
export async function verifyPlatformCatalogReleaseArtifact(
  artifactPath: string,
  expected: Readonly<PlatformCatalogV2>
): Promise<Readonly<PlatformCatalogV2>> {
  const actual = await readFile(resolve(artifactPath), "utf8");
  const loaded = parsePlatformCatalogV2Artifact(actual).catalog;
  verifyReleaseBytes(actual, loaded, expected);
  return loaded;
}

function verifyReleaseBytes(
  actual: string,
  loaded: Readonly<PlatformCatalogV2>,
  expected: Readonly<PlatformCatalogV2>
): void {
  const expectedSerialized = serializePlatformCatalogRelease(expected);
  if (actual !== expectedSerialized) {
    throw new Error(
      `Platform catalog release does not match current tracked inputs: expected ${expected.digest}, received ${loaded.digest}.`
    );
  }
}

function listTrackedProfilePaths(repoRoot: string): string[] {
  const output = execFileSync(
    "git",
    ["-C", repoRoot, "ls-files", "-z", "--cached", "--", "plugins"],
    { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 }
  );
  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function pluginResourcePath(
  repositoryPath: string
): { pluginId: string; path: string } | undefined {
  const pluginResource = repositoryPath.match(PLUGIN_RESOURCES_PATTERN);
  if (pluginResource?.[1] && pluginResource[2]) {
    return { pluginId: pluginResource[1], path: pluginResource[2] };
  }
  return undefined;
}

async function loadLockedAgentManifests(
  repoRoot: string,
  trackedPaths: readonly string[]
): Promise<Array<(typeof REVIEWED_PLUGIN_MANIFESTS_V2)[number]>> {
  if (!trackedPaths.includes(AGENT_PLUGIN_LOCK_PATH)) return [];
  const lock = parseAgentPluginLock(
    JSON.parse(await readFile(join(repoRoot, AGENT_PLUGIN_LOCK_PATH), "utf8"))
  );
  const manifests = [];
  for (const entry of lock) {
    if (entry.manifest !== `plugins/${entry.id}/agent.manifest.json`) {
      throw new Error(`Agent plugin lock has a non-canonical manifest path: ${entry.manifest}.`);
    }
    if (!trackedPaths.includes(entry.manifest)) {
      throw new Error(`Locked agent manifest is not tracked by Git: ${entry.manifest}.`);
    }
    const manifest = PluginManifestV2Schema.parse(
      JSON.parse(await readFile(join(repoRoot, entry.manifest), "utf8"))
    );
    if (manifest.id !== entry.id || manifest.activation !== "built-in") {
      throw new Error(`Locked agent manifest identity does not match: ${entry.id}.`);
    }
    if (
      manifest.agents.length !== 1 ||
      manifest.localToolProviders.length > 0 ||
      manifest.brokerProviders.length > 0 ||
      manifest.runtimeFeatures.length > 0
    ) {
      throw new Error(`Locked agent package may contribute exactly one agent and no providers.`);
    }
    manifests.push(manifest);
  }
  return manifests;
}

function parseAgentPluginLock(value: unknown): Array<{ id: string; manifest: string }> {
  if (typeof value !== "object" || value === null) throw new Error("Invalid agent plugin lock.");
  const lock = value as Record<string, unknown>;
  if (lock.schemaVersion !== 1 || !Array.isArray(lock.agents)) {
    throw new Error("Invalid agent plugin lock.");
  }
  const entries = lock.agents;
  if (
    !entries.every(
      (entry): entry is { id: string; manifest: string } =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as Record<string, unknown>).id === "string" &&
        typeof (entry as Record<string, unknown>).manifest === "string"
    )
  ) {
    throw new Error("Invalid agent plugin lock entry.");
  }
  const ids = entries.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate agent plugin lock id.");
  return [...entries].sort((left, right) => left.id.localeCompare(right.id));
}

function filterResourcesForManifest(
  manifest: (typeof REVIEWED_PLUGIN_MANIFESTS_V2)[number],
  files: PluginPackageV2["files"]
): Map<string, string | Uint8Array> {
  const roots = manifest.agents.flatMap((agent) => [
    agent.promptPath,
    ...agent.skillPaths,
    ...agent.extensionPaths
  ]);
  return new Map(
    [...files.entries()].filter(([path]) =>
      roots.some((root) => path === root || path.startsWith(`${root}/`))
    )
  );
}
