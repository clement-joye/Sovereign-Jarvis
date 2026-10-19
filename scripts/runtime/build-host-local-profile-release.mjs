import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildPluginRuntimeImages } from "../plugins/build-plugin-runtime-images.mjs";
import { buildProfileResourceBundle } from "./build-profile-resource-bundle.mjs";
import { buildHostLocalReleaseManifest, imageTag } from "./host-local-profile-release.mjs";

// Docker tags do not permit SemVer build metadata (`+`), unlike the source
// release version. The provisioner records the immutable image ID, never this
// convenience tag.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

async function main() {
  const outputPath = resolve(readRequiredOption("--output"));
  const resourcesOnly = process.argv.includes("--resources-only");
  const projectRoot = resolve(new URL("../..", import.meta.url).pathname);
  const resourceBundle = await buildProfileResourceBundle({
    profileRoot: resolve(projectRoot, "deploy/pi-runtime"),
    pluginsRoot: resolve(projectRoot, "plugins"),
    outputRoot: dirname(outputPath)
  });

  if (resourcesOnly) {
    const current = JSON.parse(await readFile(outputPath, "utf8"));
    await writeCurrentHostLocalRuntimeManifest(
      outputPath,
      resourceOnlyHostLocalReleaseManifest(current, resourceBundle)
    );
    process.stdout.write(
      `Updated host-local resource bundle without rebuilding images: ${outputPath}\n`
    );
    return;
  }

  assertReviewedRuntimeSourcesClean(projectRoot);
  await preservePublishedBaseImage(outputPath);
  run("docker", [
    "build",
    "--pull=false",
    "--file",
    "deploy/images/pi-jarvis.Dockerfile",
    "--target",
    "base-runtime",
    "--tag",
    imageTag,
    projectRoot
  ]);
  const imageId = currentImageId(imageTag);
  const runtimeImageIds = buildPluginRuntimeImages({
    root: projectRoot,
    baseRuntimeImage: imageTag
  });

  await writeCurrentHostLocalRuntimeManifest(
    outputPath,
    buildHostLocalReleaseManifest(imageId, runtimeImageIds, {
      digest: resourceBundle.digest,
      artifactName: resourceBundle.artifactName
    })
  );
  process.stdout.write(`Updated current host-local runtime profile: ${outputPath}\n`);
}

/** Keep the published image reachable when a rebuild moves the `current` tag. */
export async function preservePublishedBaseImage(outputPath, execute = run) {
  let current;
  try {
    current = JSON.parse(await readFile(outputPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  const imageId = current?.currentRuntime?.imageId;
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId ?? "")) {
    throw new Error("Published runtime profile has no immutable base image ID.");
  }
  try {
    execute("docker", ["image", "inspect", imageId]);
  } catch {
    // A full rebuild is also the recovery path for an image already lost.
    return;
  }
  execute("docker", ["tag", imageId, `jarvis/pi-jarvis:pinned-${imageId.slice(7)}`]);
}

/** A release cannot claim a Git revision while using uncommitted runtime inputs. */
export function assertReviewedRuntimeSourcesClean(projectRoot, execute = run) {
  const changes = execute("git", [
    "-C",
    projectRoot,
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    "deploy/pi-runtime",
    "deploy/images/pi-jarvis.Dockerfile",
    "deploy/images/pi-jarvis.Dockerfile.dockerignore",
    "plugins/core-agents/resources/extensions",
    "plugins/browser/resources/extensions",
    "plugins/browser/resources/browser/bin",
    "plugins/browser/deploy/browser.Dockerfile",
    "plugins/browser/deploy/browser.Dockerfile.dockerignore",
    "plugins/browser/deploy/install-verified-playwright.mjs",
    "plugins/browser/deploy/playwright-archives.json"
  ]);
  if (changes.trim()) {
    throw new Error(`Commit reviewed runtime sources before building a release:\n${changes}`);
  }
}

/** Preserves every executable identity while publishing a new prompt/skill bundle. */
export function resourceOnlyHostLocalReleaseManifest(current, resourceBundle) {
  const imageId = current?.currentRuntime?.imageId;
  const profileImage = current?.profileArtifact?.runtimeImage;
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId ?? "") || profileImage !== imageId) {
    throw new Error("Resource-only publication requires a valid current immutable runtime image.");
  }
  for (const value of Object.values(current.currentRuntime.runtimeImageIds ?? {})) {
    if (!/^sha256:[a-f0-9]{64}$/.test(value)) {
      throw new Error("Resource-only publication requires immutable plugin runtime images.");
    }
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(resourceBundle?.digest ?? "")) {
    throw new Error("Resource-only publication requires an immutable resource digest.");
  }
  if (
    typeof resourceBundle?.artifactName !== "string" ||
    !resourceBundle.artifactName ||
    resourceBundle.artifactName.startsWith("/") ||
    resourceBundle.artifactName.includes("..")
  ) {
    throw new Error("Resource-only publication requires a safe resource artifact name.");
  }
  return {
    ...current,
    currentRuntime: {
      ...current.currentRuntime,
      resourceBundle: {
        digest: resourceBundle.digest,
        artifactName: resourceBundle.artifactName
      }
    }
  };
}

function currentImageId(tag) {
  const value = run("docker", ["image", "inspect", "--format", "{{.Id}}", tag]).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(value))
    throw new Error(`Docker did not return an immutable image ID: ${value}`);
  return value;
}

/** Atomically replaces the one current runtime profile; no history is retained. */
export async function writeCurrentHostLocalRuntimeManifest(outputPath, manifest) {
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  await chmod(temporaryPath, 0o644);
  await rename(temporaryPath, outputPath);
}

function readRequiredOption(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Usage: build-host-local-profile-release.mjs ${name} <manifest-path>`);
  }
  return value;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
    ...(command === "docker" ? { env: { ...process.env, DOCKER_BUILDKIT: "1" } } : {})
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr ?? "unknown error"}`);
  }
  return result.stdout ?? "";
}
