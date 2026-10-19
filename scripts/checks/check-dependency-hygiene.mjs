import { access, readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const workspaceRoots = ["apps", "packages"];
const sourceExtension = ".ts";
const testFilePattern = /(?:\.test|\.integration\.test|\.contract\.test)\.ts$/;

const packageDirectories = (
  await Promise.all(workspaceRoots.map((root) => workspacePackageDirectories(root)))
).flat();
const problems = [];

for (const directory of packageDirectories) {
  const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  const importedPackages = await importedRuntimePackages(directory);
  const declaredDependencies = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {})
  ]);
  const runtimeDependencies = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {})
  ]);
  const packageName = manifest.name ?? relative(".", directory);

  for (const dependency of runtimeDependencies) {
    if (!importedPackages.has(dependency)) {
      problems.push(`${packageName}: unused runtime dependency ${dependency}`);
    }
  }
  for (const dependency of importedPackages) {
    if (!declaredDependencies.has(dependency)) {
      problems.push(`${packageName}: missing runtime dependency ${dependency}`);
    }
  }
}

if (problems.length > 0) {
  console.error(
    "Dependency hygiene check failed:\n" + problems.map((problem) => `- ${problem}`).join("\n")
  );
  process.exitCode = 1;
} else {
  console.log(
    `Dependency hygiene check passed for ${packageDirectories.length} workspace packages.`
  );
}

async function workspacePackageDirectories(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const directories = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, entry.name);
    if (await hasPackageManifest(directory)) directories.push(directory);
  }
  return directories;
}

async function hasPackageManifest(directory) {
  try {
    await access(join(directory, "package.json"));
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function importedRuntimePackages(directory) {
  const sourceDirectory = join(directory, "src");
  const sourceFiles = await sourceFilesIn(sourceDirectory);
  const imports = new Set();

  for (const sourceFile of sourceFiles) {
    if (testFilePattern.test(sourceFile)) {
      continue;
    }
    const content = await readFile(sourceFile, "utf8");
    for (const specifier of content.matchAll(
      /(?:^|[\n;])\s*import\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gm
    )) {
      const packageName = packageNameFor(specifier[1]);
      if (packageName) {
        imports.add(packageName);
      }
    }
    for (const specifier of content.matchAll(
      /(?:^|[\n;])\s*export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+["']([^"']+)["']/gm
    )) {
      const packageName = packageNameFor(specifier[1]);
      if (packageName) {
        imports.add(packageName);
      }
    }
    for (const specifier of content.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
      const packageName = packageNameFor(specifier[1]);
      if (packageName) {
        imports.add(packageName);
      }
    }
  }
  return imports;
}

async function sourceFilesIn(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          return sourceFilesIn(path);
        }
        return entry.isFile() && entry.name.endsWith(sourceExtension) ? [path] : [];
      })
    );
    return nested.flat();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function packageNameFor(specifier) {
  if (specifier.startsWith(".") || specifier.startsWith("node:")) {
    return undefined;
  }
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }
  return specifier.split("/")[0];
}
