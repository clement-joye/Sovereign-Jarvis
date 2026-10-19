import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const runtimeProfileWorkerServiceNames = ["brain-worker", "brain-delegation-worker"];

export const runtimeProfileServiceNames = [
  "brain-control",
  "matrix-gateway",
  "runtime-provisioner",
  ...runtimeProfileWorkerServiceNames
];

export function pluginIntegrityPreflightArgs(projectRoot) {
  return [
    "--import",
    "tsx",
    resolve(projectRoot, "scripts/plugins/plugin-workflow.mjs"),
    "validate"
  ];
}

/** Uses TypeScript's project build cache; Docker images already provide clean release builds. */
export function incrementalTypecheckArgs(projectRoot) {
  return ["--dir", projectRoot, "exec", "tsc", "-b"];
}

export function runtimeImageVerificationArgs(projectRoot, runtimeClass, imageId) {
  return [
    resolve(projectRoot, "scripts/runtime/verify-host-local-profile-runtime.mjs"),
    "--image",
    imageId,
    "--runtime-class",
    runtimeClass
  ];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(parseOptions(process.argv.slice(2)));
}

/** Runs the complete, host-admin update flow for the reviewed room runtime. */
export function parseOptions(args) {
  const option = (name) => {
    const index = args.indexOf(name);
    if (index === -1) return undefined;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
    return value;
  };
  if (args.includes("--help")) {
    return { help: true };
  }
  const known = new Set([
    "--env-file",
    "--compose-file",
    "--runtime-profile-dir",
    "--platform-catalog-dir",
    "--new-rooms-only",
    "--resources-only",
    "--publish-only"
  ]);
  for (const arg of args) {
    if (arg.startsWith("--") && !known.has(arg)) throw new Error(`Unknown option: ${arg}`);
  }
  const platformCatalogDir = option("--platform-catalog-dir");
  const publishOnly = args.includes("--publish-only");
  if (publishOnly && args.includes("--new-rooms-only")) {
    throw new Error("--publish-only cannot be combined with --new-rooms-only.");
  }
  return {
    envFile: option("--env-file") ?? "deploy/compose/.env.production",
    composeFile: option("--compose-file") ?? "deploy/compose/compose.production.yml",
    runtimeProfileDir: option("--runtime-profile-dir"),
    ...(platformCatalogDir ? { platformCatalogDir } : {}),
    resourcesOnly: args.includes("--resources-only"),
    publishOnly,
    replaceRoomRuntimes: !args.includes("--new-rooms-only")
  };
}

function main(options) {
  if (options.help) {
    process.stdout.write(
      `Usage: node scripts/runtime/update-host-local-runtime-profile.mjs [options]\n\n`
    );
    process.stdout.write(
      `Builds and verifies the reviewed room-runtime images and platform catalog, then reloads their consumers.\n\n`
    );
    process.stdout.write(`Options:\n`);
    process.stdout.write(
      `  --env-file <path>             Compose environment file (default: deploy/compose/.env.production)\n`
    );
    process.stdout.write(
      `  --compose-file <path>         Compose file (default: deploy/compose/compose.production.yml)\n`
    );
    process.stdout.write(
      `  --runtime-profile-dir <path>  Override RUNTIME_PROFILE_DIR from the environment file\n`
    );
    process.stdout.write(
      `  --platform-catalog-dir <path> Override PLATFORM_CATALOG_DIR from the environment file\n`
    );
    process.stdout.write(`  --new-rooms-only              Do not replace existing room runtimes\n`);
    process.stdout.write(
      `  --resources-only              Publish prompts/skills without rebuilding executable images\n`
    );
    process.stdout.write(
      `  --publish-only                Publish and verify artifacts without migrations or service changes\n`
    );
    return;
  }

  runHostLocalRuntimeProfileUpdate(options);
}

export function runHostLocalRuntimeProfileUpdate(options, dependencies = {}) {
  const projectRoot = resolve(
    dependencies.projectRoot ?? new URL("../..", import.meta.url).pathname
  );
  const envFile = resolve(projectRoot, options.envFile);
  const composeFile = resolve(projectRoot, options.composeFile);
  const runtimeProfileDir = options.runtimeProfileDir
    ? resolve(options.runtimeProfileDir)
    : resolveRequiredEnvPath(envFile, "RUNTIME_PROFILE_DIR");
  const platformCatalogDir = options.platformCatalogDir
    ? resolve(options.platformCatalogDir)
    : resolveRequiredEnvPath(envFile, "PLATFORM_CATALOG_DIR");
  const manifestPath = resolve(runtimeProfileDir, "current-runtime.json");
  const catalogPath = resolve(platformCatalogDir, "platform-catalog.v2.json");
  const compose = ["compose", "--project-name", "jarvis", "--env-file", envFile, "-f", composeFile];

  // Plugin source is reviewed with this checkout. Validate the installed
  // composition before migrations and Docker builds.
  const execute = dependencies.run ?? run;
  const captureOutput = dependencies.capture ?? capture;
  const writeOutput = dependencies.write ?? ((value) => process.stdout.write(value));
  execute(process.execPath, pluginIntegrityPreflightArgs(projectRoot));

  if (!options.resourcesOnly && !options.publishOnly) {
    // Executable/policy releases may introduce new durable identifiers. A
    // prompt/skill-only publication cannot change that schema surface.
    execute(process.execPath, [
      resolve(projectRoot, "scripts/migrations/apply-database-migrations.mjs"),
      "--project-name",
      "jarvis",
      "--env-file",
      envFile,
      "--compose-file",
      composeFile
    ]);
  }

  if (options.resourcesOnly) {
    // Resource publications reuse the current image pins. Check them before
    // writing either release artifact or removing room containers.
    const checkedImages = new Set();
    for (const [runtimeClass, imageId] of Object.entries(currentRuntimeImages(manifestPath))) {
      if (checkedImages.has(imageId)) continue;
      checkedImages.add(imageId);
      try {
        execute("docker", ["image", "inspect", "--format", "{{.Id}}", imageId]);
      } catch (error) {
        throw new Error(
          `Reviewed ${runtimeClass} runtime image is unavailable: ${imageId}. Rebuild the runtime with pnpm jarvis:update runtime --confirm-interruption before publishing resources.`,
          { cause: error }
        );
      }
    }
  }

  execute(
    process.execPath,
    hostLocalProfileReleaseBuildArgs(projectRoot, manifestPath, options.resourcesOnly)
  );
  const runtimeImages = currentRuntimeImages(manifestPath);
  if (!options.resourcesOnly) {
    for (const [runtimeClass, imageId] of Object.entries(runtimeImages)) {
      execute(process.execPath, runtimeImageVerificationArgs(projectRoot, runtimeClass, imageId));
    }
  }
  // Installed plugin packages expose compiled entry points. Rebuild only
  // projects whose inputs changed; the Docker release builds remain clean
  // from source and therefore catch cache-related build defects separately.
  execute("pnpm", incrementalTypecheckArgs(projectRoot));
  const catalogCommand = [
    resolve(projectRoot, "scripts/plugins/platform-catalog-release.mjs"),
    "--output",
    catalogPath,
    ...Object.entries(runtimeImages).flatMap(([id, image]) => ["--runtime-image", `${id}=${image}`])
  ];
  // The catalog builder imports TypeScript source through its package entry
  // points, so invoke it with the same loader as the root catalog commands.
  execute(process.execPath, [
    "--import",
    "tsx",
    catalogCommand[0],
    "build",
    ...catalogCommand.slice(1)
  ]);
  execute(process.execPath, [
    "--import",
    "tsx",
    catalogCommand[0],
    "verify",
    ...catalogCommand.slice(1)
  ]);
  if (options.publishOnly) {
    writeOutput(
      "Runtime profile and platform catalog published; no migrations or services were changed.\n"
    );
    return;
  }
  if (options.replaceRoomRuntimes) {
    // Do this only after the new profile is built, verified, and published so
    // a build failure never leaves inbound processing stopped. It must happen
    // before Compose recreates a network: dynamic Browser containers can be
    // attached to a network whose definition just changed.
    // `runtime-provisioner` is attached to the Browser network. Remove it
    // before Compose applies a changed definition for that network; otherwise
    // Docker can retain a stale endpoint while attempting the recreation.
    execute("docker", [
      ...compose,
      "stop",
      ...runtimeProfileWorkerServiceNames,
      "runtime-provisioner"
    ]);
    try {
      execute("docker", [...compose, "rm", "--force", "runtime-provisioner"]);
      const runtimeContainers = lines(
        captureOutput("docker", ["ps", "--all", "--quiet", "--filter", "name=^jarvis-workspace-"])
      );
      if (runtimeContainers.length > 0) {
        // Deliberately omit --volumes: a profile upgrade changes executable code,
        // not room data or Pi session history.
        execute("docker", ["rm", "--force", ...runtimeContainers]);
      }

      // This command publishes a runtime profile; it does not change the
      // reviewed application service images. Recreate every catalog consumer
      // so none retains the previous digest in memory, while leaving image
      // builds to the platform release workflow.
      execute("docker", [
        ...compose,
        "up",
        "--detach",
        "--no-build",
        "--force-recreate",
        ...runtimeProfileServiceNames
      ]);
    } finally {
      // The workers were explicitly stopped above, so start those exact
      // containers again. Recreating them here makes Compose reconcile
      // unrelated networks and can fail after a Browser-network definition
      // change.
      execute("docker", [...compose, "start", ...runtimeProfileWorkerServiceNames]);
    }
    writeOutput(
      "Recreated room runtime containers; workspace and session volumes were preserved.\n"
    );
  } else {
    execute("docker", [
      ...compose,
      "up",
      "--detach",
      "--no-build",
      "--force-recreate",
      ...runtimeProfileServiceNames
    ]);
    writeOutput(
      "New rooms will use the updated profile; existing room runtimes were left unchanged.\n"
    );
  }
}

export function hostLocalProfileReleaseBuildArgs(projectRoot, manifestPath, resourcesOnly) {
  return [
    "--import",
    "tsx",
    resolve(projectRoot, "scripts/runtime/build-host-local-profile-release.mjs"),
    "--output",
    manifestPath,
    ...(resourcesOnly ? ["--resources-only"] : [])
  ];
}

function resolveRequiredEnvPath(envFile, name) {
  const raw = readFileSync(envFile, "utf8");
  const line = raw.split(/\r?\n/).find((entry) => entry.startsWith(`${name}=`));
  const value = line
    ?.slice(name.length + 1)
    .trim()
    .replace(/^['"]|['"]$/g, "");
  if (!value)
    throw new Error(`${name} must be set in ${envFile} or passed with its command-line override.`);
  if (!value.startsWith("/")) throw new Error(`${name} must be an absolute path.`);
  return value;
}

function currentRuntimeImages(manifestPath) {
  const runtime = JSON.parse(readFileSync(manifestPath, "utf8"))?.currentRuntime;
  const imageId = runtime?.imageId;
  if (typeof imageId !== "string")
    throw new Error(`Invalid runtime profile manifest: ${manifestPath}`);
  const pluginRuntimeImages = runtime?.runtimeImageIds;
  if (!pluginRuntimeImages || typeof pluginRuntimeImages !== "object") {
    throw new Error(`Missing plugin runtime images in profile manifest: ${manifestPath}`);
  }
  for (const [id, value] of Object.entries(pluginRuntimeImages)) {
    if (!/^[a-z][a-z0-9-]{0,63}$/u.test(id) || typeof value !== "string") {
      throw new Error(`Invalid plugin runtime image in profile manifest: ${manifestPath}`);
    }
  }
  return { base: imageId, isolated: imageId, ...pluginRuntimeImages };
}

function lines(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "inherit",
    ...(command === "docker" ? { env: { ...process.env, DOCKER_BUILDKIT: "1" } } : {})
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
