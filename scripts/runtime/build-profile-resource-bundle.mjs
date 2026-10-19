import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resourceFiles, safeRelativePath } from "./bundle-profile-resources.mjs";

const BUNDLE_MANIFEST = "resource-bundle.json";
const BUNDLE_SCHEMA_VERSION = 1;
const EXECUTABLE_RESOURCE_ROOTS = ["extensions/", "browser/bin/"];

/**
 * Builds and atomically publishes the reviewed, non-executable profile
 * resources used by role sessions. Selected extensions, models, and their
 * package dependencies remain inputs to the executable runtime images.
 */
export async function buildProfileResourceBundle({
  profileRoot,
  pluginsRoot,
  outputRoot,
  acceptedResourcesPath = join(profileRoot, "accepted-resources.txt"),
  classificationPath = join(profileRoot, "classification.json")
}) {
  const plugins = resolve(pluginsRoot);
  const output = resolve(outputRoot);
  const reviewed = await readReviewedResources(acceptedResourcesPath, classificationPath);
  const files = await collectRoleResources(plugins, reviewed);
  const digest = profileResourceDigest(files);
  const paths = [...files.keys()].sort(comparePaths);
  const artifactName = `resource-bundles/${digest.slice("sha256:".length)}`;
  await ensureDirectory(output);
  const bundleRoot = join(output, "resource-bundles");
  await ensureDirectory(bundleRoot);
  const destination = join(output, artifactName);

  if (await canReuse(destination, digest, paths)) {
    return { artifactName, digest, files: paths, outputRoot: output, reused: true };
  }

  const temporary = await mkdtemp(join(bundleRoot, `.${digest.slice("sha256:".length)}.tmp-`));
  // Dynamic runtimes use an unprivileged UID and receive this directory as a
  // read-only bind mount, so every published directory must be traversable.
  await chmod(temporary, 0o755);
  let published = false;
  try {
    for (const path of paths) {
      const target = join(temporary, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, files.get(path));
    }
    await writeFile(
      join(temporary, BUNDLE_MANIFEST),
      `${JSON.stringify({ schemaVersion: BUNDLE_SCHEMA_VERSION, digest, files: paths }, null, 2)}\n`,
      "utf8"
    );
    await publishDirectory(temporary, destination);
    published = true;
  } finally {
    if (!published) await rm(temporary, { recursive: true, force: true });
  }
  return { artifactName, digest, files: paths, outputRoot: output, reused: false };
}

/** Computes the canonical digest for a sorted set of relative resource paths. */
export function profileResourceDigest(files) {
  const hash = createHash("sha256");
  for (const [path, content] of [...files.entries()].sort(([left], [right]) =>
    comparePaths(left, right)
  )) {
    safeRelativePath(path, "resource");
    hash.update(path, "utf8");
    hash.update("\0", "utf8");
    hash.update(content);
    hash.update("\0", "utf8");
  }
  return `sha256:${hash.digest("hex")}`;
}

async function readReviewedResources(acceptedResourcesPath, classificationPath) {
  const accepted = (await readFile(resolve(acceptedResourcesPath), "utf8"))
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter((value) => value && !value.startsWith("#"));
  const uniqueAccepted = [...new Set(accepted)];
  if (uniqueAccepted.length !== accepted.length) throw new Error("Duplicate accepted resource.");
  for (const path of uniqueAccepted) safeRelativePath(path, "accepted resource");

  const classification = JSON.parse(await readFile(resolve(classificationPath), "utf8"));
  const resources = classification?.resources;
  if (!resources || typeof resources !== "object" || Array.isArray(resources)) {
    throw new Error(`Invalid profile resource classification: ${classificationPath}.`);
  }
  const classified = Object.keys(resources);
  if (
    classified.length !== uniqueAccepted.length ||
    classified.some((path) => !uniqueAccepted.includes(path)) ||
    uniqueAccepted.some((path) => !Object.hasOwn(resources, path))
  ) {
    throw new Error("Accepted resources and classification do not match.");
  }
  for (const path of uniqueAccepted) {
    if (resources[path]?.compatibility !== "sdk-compatible") {
      throw new Error(`Profile resource is not SDK-compatible: ${path}.`);
    }
  }
  return { accepted: new Set(uniqueAccepted), classification: resources };
}

async function collectRoleResources(pluginsRoot, reviewed) {
  const files = new Map();
  const entries = await readdir(pluginsRoot, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) {
      if (entry.isSymbolicLink())
        throw new Error(
          `Plugin source must not contain symlinks: ${join(pluginsRoot, entry.name)}.`
        );
      continue;
    }
    const pluginRoot = join(pluginsRoot, entry.name);
    const resourcesRoot = join(pluginRoot, "resources");
    let resourceStat;
    try {
      resourceStat = await lstat(resourcesRoot);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (resourceStat.isSymbolicLink())
      throw new Error(`Plugin resources must not be a symlink: ${resourcesRoot}.`);
    if (!resourceStat.isDirectory())
      throw new Error(`Plugin resources must be a directory: ${resourcesRoot}.`);

    for (const sourcePath of await resourceFiles(resourcesRoot)) {
      const target = safeRelativePath(relative(resourcesRoot, sourcePath), "resource");
      if (isExecutableResource(target)) continue;
      if (!isRoleResource(target)) throw new Error(`Unaccepted plugin resource: ${target}.`);
      const acceptedRoot = roleAcceptedRoot(target, reviewed.accepted);
      if (!acceptedRoot) throw new Error(`Unaccepted plugin resource: ${target}.`);
      const content = await readFile(sourcePath);
      const existing = files.get(target);
      if (existing) {
        if (!existing.equals(content))
          throw new Error(`Conflicting bundled plugin resource: ${target}.`);
        throw new Error(`Duplicate bundled plugin resource: ${target}.`);
      }
      files.set(target, content);
    }
  }

  for (const accepted of reviewed.accepted) {
    if (!isRoleResource(accepted) || accepted.endsWith("/skills")) continue;
    if (!files.has(accepted)) throw new Error(`Missing reviewed role resource: ${accepted}.`);
  }
  for (const accepted of reviewed.accepted) {
    if (!accepted.endsWith("/skills")) continue;
    if (![...files.keys()].some((path) => path.startsWith(`${accepted}/`))) {
      throw new Error(`Missing reviewed role skills: ${accepted}.`);
    }
  }
  return files;
}

function isRoleResource(path) {
  const parts = path.split("/");
  return (
    (parts.length >= 2 && parts[1] === "AGENTS.md") || (parts.length >= 3 && parts[1] === "skills")
  );
}

function roleAcceptedRoot(path, accepted) {
  if (accepted.has(path)) return path;
  const parts = path.split("/");
  if (parts.length >= 3 && parts[1] === "skills") {
    const root = `${parts[0]}/skills`;
    if (accepted.has(root)) return root;
  }
  return undefined;
}

function isExecutableResource(path) {
  return EXECUTABLE_RESOURCE_ROOTS.some((root) => path.startsWith(root));
}

async function canReuse(output, digest, paths) {
  let stat;
  try {
    stat = await lstat(output);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  if (stat.isSymbolicLink())
    throw new Error(`Profile resource bundle must not be a symlink: ${output}.`);
  if (!stat.isDirectory())
    throw new Error(`Profile resource bundle must be a directory: ${output}.`);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(output, BUNDLE_MANIFEST), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return false;
    throw error;
  }
  if (
    manifest?.schemaVersion !== BUNDLE_SCHEMA_VERSION ||
    manifest.digest !== digest ||
    !Array.isArray(manifest.files) ||
    JSON.stringify(manifest.files) !== JSON.stringify(paths)
  )
    return false;
  const contents = new Map();
  for (const path of paths) {
    const filePath = join(output, path);
    const fileStat = await lstat(filePath);
    if (!fileStat.isFile()) return false;
    contents.set(path, await readFile(filePath));
  }
  return profileResourceDigest(contents) === digest;
}

async function publishDirectory(temporary, output) {
  let existing;
  try {
    existing = await lstat(output);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (existing?.isSymbolicLink())
    throw new Error(`Profile resource bundle must not be a symlink: ${output}.`);
  if (existing)
    throw new Error(`Digest-addressed profile resource bundle already exists: ${output}.`);
  await rename(temporary, output);
}

async function ensureDirectory(path) {
  let stat;
  try {
    stat = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      await mkdir(path, { recursive: true });
      return;
    }
    throw error;
  }
  if (stat.isSymbolicLink())
    throw new Error(`Profile resource directory must not be a symlink: ${path}.`);
  if (!stat.isDirectory())
    throw new Error(`Profile resource directory must be a directory: ${path}.`);
}

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseOptions(process.argv.slice(2));
  const result = await buildProfileResourceBundle(options);
  process.stdout.write(
    `${result.reused ? "Reused" : "Published"} profile resource bundle ${result.digest}: ${result.artifactName}\n`
  );
}

function parseOptions(args) {
  const value = (names) => {
    const name = names.find((candidate) => args.includes(candidate));
    if (!name) return undefined;
    const index = args.indexOf(name);
    const result = args[index + 1];
    if (!result || result.startsWith("--")) throw new Error(`${name} requires a value.`);
    return result;
  };
  const profileRoot = value(["--profile-root", "--profile"]);
  const pluginsRoot = value(["--plugins-root", "--plugins"]);
  const outputRoot = value(["--runtime-profile-dir", "--output"]);
  if (!profileRoot || !pluginsRoot || !outputRoot) {
    throw new Error(
      "Usage: build-profile-resource-bundle.mjs --profile-root <path> --plugins-root <path> --runtime-profile-dir <path>"
    );
  }
  return {
    profileRoot,
    pluginsRoot,
    outputRoot,
    acceptedResourcesPath: value(["--accepted-resources"]),
    classificationPath: value(["--classification"])
  };
}
