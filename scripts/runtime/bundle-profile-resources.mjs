import { copyFile, mkdir, readFile, lstat, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

/** Copies a plugin's conventional resources/ tree into the immutable profile. */
export async function bundlePluginResources({ pluginRoot, outputRoot, claimedPaths }) {
  const root = resolve(pluginRoot);
  const resourcesRoot = join(root, "resources");
  const output = resolve(outputRoot);
  const claimed = claimedPaths ?? new Set();
  const files = await resourceFiles(resourcesRoot);
  const targets = new Set();

  for (const sourcePath of files) {
    const target = safeRelativePath(relative(resourcesRoot, sourcePath), "resource");
    if (claimed.has(target)) throw new Error(`Duplicate bundled plugin resource: ${target}.`);
    claimed.add(target);
    targets.add(target.split("/")[0]);
    const targetPath = join(output, target);
    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
  }
  return [...targets].sort((left, right) => left.localeCompare(right));
}

export async function bundlePluginDirectory({ manifestRoot, outputRoot }) {
  const root = resolve(manifestRoot);
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .sort((left, right) => left.localeCompare(right));
  const targets = new Set();
  const claimedPaths = new Set();
  for (const pluginRoot of entries) {
    try {
      await lstat(join(pluginRoot, "resources"));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    for (const target of await bundlePluginResources({ pluginRoot, outputRoot, claimedPaths })) {
      targets.add(target);
    }
  }
  return [...targets].sort((left, right) => left.localeCompare(right));
}

export async function updateAcceptedResources(path, pluginTargets) {
  const existing = (await readFile(resolve(path), "utf8"))
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter((value) => value && !value.startsWith("#"));
  const resources = [...new Set([...existing, ...pluginTargets])];
  await writeFile(resolve(path), `${resources.join("\n")}\n`, "utf8");
}

/** Lists regular files below a resource root while rejecting symlinks. */
export async function resourceFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await resourceFiles(path)));
    else if (entry.isFile()) files.push(path);
    else if (entry.isSymbolicLink())
      throw new Error(`Plugin resource must not be a symlink: ${path}.`);
    else throw new Error(`Plugin resource must be a regular file or directory: ${path}.`);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

export function safeRelativePath(value, label) {
  if (
    !value ||
    isAbsolute(value) ||
    value.includes("\\") ||
    value.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Invalid ${label} path: ${value}.`);
  }
  return value;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const outputRoot = requiredOption("--output");
  const targets = await bundlePluginDirectory({
    manifestRoot: requiredOption("--plugins"),
    outputRoot
  });
  const acceptedResources = optionalOption("--accepted-resources");
  if (acceptedResources) await updateAcceptedResources(acceptedResources, targets);
}

function requiredOption(name) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("Usage: bundle-profile-resources.mjs --plugins <path> --output <path>");
  }
  return value;
}

function optionalOption(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}
