import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { INSTALLED_PLUGIN_MANIFESTS_V2 } from "../../packages/installed-plugins/src/catalog.ts";

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runtimeImages = buildPluginRuntimeImages({
    root: resolve(new URL("../..", import.meta.url).pathname),
    baseRuntimeImage: option("--base-runtime-image") ?? "jarvis/pi-jarvis:current"
  });
  process.stdout.write(`${JSON.stringify({ runtimeImages })}\n`);
}

export const runtimeBuildInputLabel = "com.jarvis.runtime.build-input";

/** Builds optional runtime images declared and owned by installed plugins. */
export function buildPluginRuntimeImages({ root, baseRuntimeImage }) {
  root = resolve(root);
  const runtimeImages = {};
  let baseRuntimeImageId;
  for (const plugin of INSTALLED_PLUGIN_MANIFESTS_V2) {
    const pluginRoot = resolve(root, "plugins", requiredId(plugin.id));
    const descriptorPath = resolve(pluginRoot, "runtime.json");
    let descriptor;
    try {
      descriptor = JSON.parse(readFileSync(descriptorPath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (descriptor?.schemaVersion !== 1 || !Array.isArray(descriptor.images)) {
      throw new Error(`Invalid plugin runtime descriptor: ${descriptorPath}.`);
    }
    for (const image of descriptor.images) {
      const dockerfile = pluginPath(pluginRoot, image.dockerfile);
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(image.id ?? "")) {
        throw new Error(`Invalid plugin runtime image id: ${String(image.id)}.`);
      }
      if (typeof image.tag !== "string" || !image.tag || image.tag.includes(" ")) {
        throw new Error(`Invalid plugin runtime image tag: ${String(image.tag)}.`);
      }
      const kind = image.kind ?? "helper";
      if (kind !== "helper" && kind !== "runtime-class") {
        throw new Error(`Invalid plugin runtime image kind: ${String(kind)}.`);
      }
      if (image.baseRuntime === true && !baseRuntimeImageId) {
        baseRuntimeImageId = currentImageId(baseRuntimeImage);
      }
      const buildInput = pluginRuntimeBuildInput({
        root,
        pluginRoot,
        dockerfile,
        image,
        baseRuntimeImageId: image.baseRuntime === true ? baseRuntimeImageId : undefined
      });
      const args = [
        "build",
        "--pull=false",
        "--label",
        `${runtimeBuildInputLabel}=${buildInput}`,
        "--file",
        dockerfile,
        "--tag",
        image.tag
      ];
      if (image.baseRuntime === true) {
        args.push("--build-arg", `BASE_RUNTIME_IMAGE=${baseRuntimeImage}`);
      } else if (image.baseRuntime !== undefined && image.baseRuntime !== false) {
        throw new Error(`Invalid baseRuntime declaration for ${image.id}.`);
      }
      if (existingRuntimeBuildInput(image.tag) !== buildInput) {
        run("docker", [...args, root]);
      }
      if (kind === "runtime-class") {
        const runtimeClass = requiredId(image.runtimeClass);
        if (runtimeImages[runtimeClass]) {
          throw new Error(`Duplicate plugin runtime class image: ${runtimeClass}.`);
        }
        runtimeImages[runtimeClass] = currentImageId(image.tag);
      }
    }
  }
  return runtimeImages;
}

/**
 * Returns the content identity for one plugin-owned image. It includes the
 * descriptor, Dockerfile, and files named by Dockerfile COPY/ADD instructions;
 * a base-runtime image ID is included for derived images such as Browser.
 */
export function pluginRuntimeBuildInput({
  pluginRoot,
  root = pluginRoot,
  dockerfile,
  image,
  baseRuntimeImageId
}) {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(image));
  hash.update("\0");
  hash.update(baseRuntimeImageId ?? "");
  const inputFiles = new Map();
  addFiles(inputFiles, pluginRoot, resolve(pluginRoot, "runtime.json"));
  addFiles(inputFiles, root, dockerfile);
  for (const source of dockerfileContextSources(dockerfile)) {
    const path = resolve(root, source);
    if (path.startsWith(`${root}${sep}`)) addFiles(inputFiles, root, path);
    else inputFiles.set(`missing:${source}`, undefined);
  }
  for (const [relativePath, path] of [...inputFiles.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    hash.update(relativePath);
    hash.update("\0");
    if (!path) continue;
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function requiredId(value) {
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(value ?? "")) {
    throw new Error(`Invalid installed plugin id: ${String(value)}.`);
  }
  return value;
}

function pluginPath(pluginRoot, value) {
  if (typeof value !== "string" || !value || value.includes("\\")) {
    throw new Error(`Invalid plugin runtime path: ${String(value)}.`);
  }
  const path = resolve(pluginRoot, value);
  if (!path.startsWith(`${pluginRoot}${sep}`))
    throw new Error("Plugin runtime path escapes plugin.");
  return path;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "inherit",
    ...(command === "docker" ? { env: { ...process.env, DOCKER_BUILDKIT: "1" } } : {})
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed.`);
}

function existingRuntimeBuildInput(tag) {
  const result = spawnSync(
    "docker",
    ["image", "inspect", "--format", `{{index .Config.Labels "${runtimeBuildInputLabel}"}}`, tag],
    {
      encoding: "utf8",
      stdio: ["inherit", "pipe", "pipe"],
      env: { ...process.env, DOCKER_BUILDKIT: "1" }
    }
  );
  if (result.status !== 0) return undefined;
  const value = (result.stdout ?? "").trim();
  return value && value !== "<no value>" ? value : undefined;
}

function currentImageId(tag) {
  const value = capture("docker", ["image", "inspect", "--format", "{{.Id}}", tag]).trim();
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`Docker did not return an immutable plugin runtime image ID: ${value}`);
  }
  return value;
}

function addFiles(files, root, path) {
  for (const file of filesUnder(path)) {
    files.set(relative(root, file.path), file.path);
  }
}

function filesUnder(root) {
  const entries = [];
  let stat;
  try {
    stat = readdirSync(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOTDIR") return [{ path: root }];
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  for (const entry of stat.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      entries.push(...filesUnder(path));
    } else if (entry.isFile()) {
      entries.push({ path });
    }
  }
  return entries;
}

function dockerfileContextSources(dockerfile) {
  const sources = [];
  for (const line of readFileSync(dockerfile, "utf8").split(/\r?\n/)) {
    const match = line.trim().match(/^(?:COPY|ADD)\s+(.+)$/u);
    if (!match || /(?:^|\s)--from=/u.test(match[1])) continue;
    const parts = match[1]
      .replace(/\s+#.*$/u, "")
      .split(/\s+/u)
      .filter((part) => part && !part.startsWith("--"));
    sources.push(...parts.slice(0, -1).map((part) => part.replace(/^['"]|['"]$/gu, "")));
  }
  return sources;
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"],
    ...(command === "docker" ? { env: { ...process.env, DOCKER_BUILDKIT: "1" } } : {})
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed.`);
  return result.stdout ?? "";
}

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}
