import { chmod, lstat, mkdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Prepare readable release mounts and verify the generated setup state before startup. */
export async function assertInstallReady(stateRoot) {
  await assertSetupEnvironment(stateRoot);
  await ensureContainerArtifactAccess(stateRoot);
  await assertPublishedArtifacts(stateRoot);
}

/** Verify both release artifacts without requiring Matrix bootstrap completion. */
export async function assertPublishedArtifacts(stateRoot) {
  const runtime = await readJsonArtifact(
    join(stateRoot, "runtime-profile", "current-runtime.json"),
    "runtime profile"
  );
  const catalog = await readJsonArtifact(
    join(stateRoot, "platform-catalog", "platform-catalog.v2.json"),
    "platform catalog"
  );
  assertRuntimeProfile(runtime);
  assertPlatformCatalog(catalog);
  assertRuntimeCatalogLinkage(runtime, catalog);
}

export async function assertSetupEnvironment(stateRoot) {
  const statePath = join(stateRoot, "setup-state.json");
  const envPath = join(stateRoot, "production.env");
  let setupState;
  try {
    setupState = JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    throw new Error(`Jarvis setup state is unavailable at ${statePath}: ${error.message}`, {
      cause: error
    });
  }
  if (
    !Array.isArray(setupState?.completedStages) ||
    !setupState.completedStages.includes("environment")
  ) {
    throw new Error(
      `Jarvis setup is incomplete. Run pnpm jarvis:setup first (state: ${stateRoot}).`
    );
  }

  await assertPrivateEnvironment(envPath);
  await assertMatrixBootstrapComplete(envPath);
}

/** Check the protected preparation files needed for artifact publication, before Matrix bootstrap. */
export async function prepareArtifactPublication(stateRoot) {
  const statePath = join(stateRoot, "setup-state.json");
  let setupState;
  try {
    setupState = JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    throw new Error(`Jarvis setup state is unavailable at ${statePath}: ${error.message}`, {
      cause: error
    });
  }
  if (
    !Array.isArray(setupState?.completedStages) ||
    !setupState.completedStages.includes("environment")
  ) {
    throw new Error(`Prepare Jarvis setup before publishing artifacts (state: ${stateRoot}).`);
  }

  const envPath = join(stateRoot, "production.env");
  await assertOwnedPrivateFile(envPath);
  await ensureContainerArtifactAccess(stateRoot);
  return {
    envPath,
    runtimeProfileDir: join(stateRoot, "runtime-profile"),
    platformCatalogDir: join(stateRoot, "platform-catalog")
  };
}

/** Make only mounted release artifacts traversable to unprivileged containers. */
export async function ensureContainerArtifactAccess(stateRoot) {
  for (const name of ["runtime-profile", "platform-catalog"]) {
    const path = join(stateRoot, name);
    await mkdir(path, { recursive: true, mode: 0o700 });
    let metadata;
    try {
      metadata = await lstat(path);
    } catch (error) {
      throw new Error(`Cannot safely access setup artifact directory ${path}: ${error.message}`, {
        cause: error
      });
    }
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o022) !== 0 ||
      (typeof process.getuid === "function" && metadata.uid !== process.getuid())
    ) {
      throw new Error(
        `Setup artifact directory must be owned, not group/other-writable, and not a symlink: ${path}`
      );
    }
    // The state root and production.env remain private. Docker mounts this
    // child directory directly, so its mode must allow the container UID in.
    if ((metadata.mode & 0o777) !== 0o755) await chmod(path, 0o755);
    const artifact = join(
      path,
      name === "runtime-profile" ? "current-runtime.json" : "platform-catalog.v2.json"
    );
    const file = await lstat(artifact).catch((error) => {
      if (error?.code === "ENOENT") return undefined;
      throw error;
    });
    if (!file) continue; // Artifact publication has not run yet.
    if (
      !file.isFile() ||
      file.isSymbolicLink() ||
      (file.mode & 0o022) !== 0 ||
      (typeof process.getuid === "function" && file.uid !== process.getuid())
    ) {
      throw new Error(`Setup artifact must be an owned, non-writable regular file: ${artifact}`);
    }
    if ((file.mode & 0o777) !== 0o644) await chmod(artifact, 0o644);
  }
}

async function assertOwnedPrivateFile(path) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    throw new Error(`Generated production environment is missing: ${path}`, { cause: error });
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error(
      "The generated production environment must remain an owned, regular mode-0600 file."
    );
  }
}

async function assertMatrixBootstrapComplete(envPath) {
  const source = await readFile(envPath, "utf8");
  const required = [
    "MATRIX_OWNER_ID",
    "MATRIX_BRAIN_USER_ID",
    "MATRIX_ACCESS_TOKEN",
    "MATRIX_RECOVERY_KEY"
  ];
  const values = new Map(
    source
      .split(/\r?\n/u)
      .map((line) => {
        const separator = line.indexOf("=");
        return separator < 0 ? undefined : [line.slice(0, separator), line.slice(separator + 1)];
      })
      .filter(Boolean)
  );
  const missing = required.filter((name) => {
    const value = values.get(name)?.trim();
    return value === undefined || value === "" || value === "''" || value === '""';
  });
  if (missing.length > 0) {
    throw new Error(
      `Matrix bootstrap is incomplete (${missing.join(", ")}). Follow the Matrix bootstrap guide and populate the protected production.env before starting Jarvis.`
    );
  }
  const registrationSettings = source
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("CONTINUWUITY_ALLOW_REGISTRATION="))
    .map((line) => line.slice(line.indexOf("=") + 1).trim())
    .map((value) => {
      if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).trim();
      if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1).trim();
      return value;
    });
  if (registrationSettings.length !== 1 || registrationSettings[0].toLowerCase() !== "false") {
    throw new Error(
      "Matrix bootstrap is incomplete (temporary registration must be disabled exactly once). Set CONTINUWUITY_ALLOW_REGISTRATION to false in the protected production.env."
    );
  }
  const registrationToken = values.get("CONTINUWUITY_REGISTRATION_TOKEN")?.trim();
  if (
    registrationToken !== undefined &&
    registrationToken !== "" &&
    registrationToken !== "''" &&
    registrationToken !== '""'
  ) {
    throw new Error(
      "Matrix bootstrap is incomplete (temporary registration token is still configured). Remove CONTINUWUITY_REGISTRATION_TOKEN from the protected production.env after disabling temporary registration."
    );
  }
}

async function assertPrivateEnvironment(path) {
  let metadata;
  try {
    metadata = await stat(path);
  } catch (error) {
    throw new Error(`Generated production environment is missing: ${path}`, { cause: error });
  }
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
    throw new Error("The generated production environment must remain a regular mode-0600 file.");
  }
}

async function readJsonArtifact(path, label) {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        `Jarvis ${label} is missing at ${path}. Publish the reviewed runtime profile and platform catalog before starting.`
      );
    }
    throw new Error(`Cannot read Jarvis ${label} at ${path}: ${error.message}`, { cause: error });
  }
  try {
    const value = JSON.parse(source);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("expected a JSON object");
    }
    return value;
  } catch (error) {
    throw new Error(`Jarvis ${label} is invalid JSON at ${path}: ${error.message}`, {
      cause: error
    });
  }
}

const SHA256 = /^sha256:[a-f0-9]{64}$/u;

function assertRuntimeProfile(value) {
  const current = value.currentRuntime;
  const profile = value.profileArtifact;
  const source = profile?.source;
  if (
    value.schemaVersion !== 1 ||
    profile?.schemaVersion !== 1 ||
    typeof profile.id !== "string" ||
    typeof profile.version !== "string" ||
    !source ||
    typeof source.repository !== "string" ||
    !URL.canParse(source.repository) ||
    !/^[a-f0-9]{40}$/u.test(source.revision ?? "") ||
    !SHA256.test(source.digest ?? "") ||
    profile.runtimeImage !== current?.imageId ||
    !isSafeRelativeArtifactName(profile.modelsPath) ||
    !Array.isArray(profile.resources) ||
    profile.resources.length === 0 ||
    profile.resources.some(
      (resource) =>
        !resource ||
        !isSafeRelativeArtifactName(resource.path) ||
        !["extension", "skill", "configuration", "dependency"].includes(resource.kind) ||
        !["sdk-compatible", "interactive-only", "host-dependent", "unsuitable"].includes(
          resource.compatibility
        ) ||
        typeof resource.rationale !== "string" ||
        resource.rationale.trim() === ""
    ) ||
    typeof current?.templateId !== "string" ||
    typeof current.templateVersion !== "string" ||
    !SHA256.test(current.imageId ?? "") ||
    !["none", "restricted"].includes(current.network) ||
    !["none", "restricted"].includes(current.modelNetwork ?? "none")
  ) {
    throw new Error("Jarvis runtime profile has an invalid or inconsistent manifest.");
  }
  if (current.runtimeImageIds !== undefined) {
    if (
      !current.runtimeImageIds ||
      typeof current.runtimeImageIds !== "object" ||
      Array.isArray(current.runtimeImageIds) ||
      Object.entries(current.runtimeImageIds).some(
        ([id, image]) => !/^[a-z][a-z0-9-]{0,63}$/u.test(id) || !SHA256.test(image)
      )
    ) {
      throw new Error("Jarvis runtime profile has invalid runtime image pins.");
    }
  }
  if (
    current.resourceBundle !== undefined &&
    (!current.resourceBundle ||
      !SHA256.test(current.resourceBundle.digest ?? "") ||
      !isSafeRelativeArtifactName(current.resourceBundle.artifactName))
  ) {
    throw new Error("Jarvis runtime profile has invalid resource bundle metadata.");
  }
}

function assertPlatformCatalog(value) {
  const requiredArrays = [
    "runtimeClasses",
    "plugins",
    "agents",
    "capabilities",
    "runtimeFeatures",
    "reviewedModels"
  ];
  if (
    value.schemaVersion !== 2 ||
    !SHA256.test(value.digest ?? "") ||
    requiredArrays.some((key) => !Array.isArray(value[key])) ||
    value.runtimeClasses.length === 0 ||
    value.plugins.length === 0 ||
    value.agents.length === 0 ||
    value.runtimeClasses.some(
      (runtimeClass) =>
        !runtimeClass || typeof runtimeClass.id !== "string" || !isPinnedImage(runtimeClass.image)
    )
  ) {
    throw new Error("Jarvis platform catalog has an invalid structure or runtime image pin.");
  }
  for (const field of ["policyDigest", "resourceDigest"]) {
    if (value[field] !== undefined && !SHA256.test(value[field])) {
      throw new Error(`Jarvis platform catalog has an invalid ${field}.`);
    }
  }
  const { digest, ...content } = value;
  // Keep this canonical JSON digest projection in sync with platform-catalog-digest.ts.
  const expected = `sha256:${createHash("sha256").update(stableJson(content)).digest("hex")}`;
  if (digest !== expected) {
    throw new Error(
      `Jarvis platform catalog digest mismatch: expected ${expected}, received ${digest}.`
    );
  }
}

function assertRuntimeCatalogLinkage(runtime, catalog) {
  const current = runtime.currentRuntime;
  const catalogPins = new Map(catalog.runtimeClasses.map(({ id, image }) => [id, image]));
  const expected = {
    base: current.imageId,
    isolated: current.imageId,
    ...current.runtimeImageIds
  };
  if (
    ["base", "isolated", "browser"].some(
      (id) => !catalogPins.has(id) || catalogPins.get(id) !== expected[id]
    )
  ) {
    throw new Error("Jarvis runtime profile image pins do not match the platform catalog.");
  }
}

function isPinnedImage(value) {
  return (
    typeof value === "string" && /^(?:[a-z0-9][a-z0-9./_-]*@)?sha256:[a-f0-9]{64}$/u.test(value)
  );
}

function isSafeRelativeArtifactName(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stateRoot = process.argv[2];
  if (!stateRoot || process.argv.length > 3) {
    process.stderr.write("Usage: node scripts/setup/install-readiness.mjs <state-root>\n");
    process.exitCode = 2;
  } else {
    assertInstallReady(resolve(stateRoot)).catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
  }
}
