import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

export const templateId = "code-project";
export const templateVersion = "1.0.0";
export const imageTag = "jarvis/pi-jarvis:current";
export const brainImageTag = "jarvis/pi-jarvis:brain";

const profileDirectory = new URL("../../deploy/pi-runtime/", import.meta.url);
const acceptedResourcesPath = new URL("accepted-resources.txt", profileDirectory);
const classificationPath = new URL("classification.json", profileDirectory);
function runtimeSource() {
  const checkout = new URL("../..", import.meta.url).pathname;
  const revision = spawnSync("git", ["-C", checkout, "rev-parse", "HEAD"], {
    encoding: "utf8"
  });
  if (revision.status !== 0 || !/^[a-f0-9]{40}$/.test(revision.stdout.trim())) {
    throw new Error("A reviewed runtime release requires a Git revision.");
  }
  const hash = createHash("sha256");
  // Digest the authored runtime inputs. The image ID separately pins the
  // executable result, and the resource-bundle digest pins role instructions.
  for (const name of [
    ...runtimeFiles(join(checkout, "deploy/pi-runtime"), "deploy/pi-runtime"),
    ...runtimeFiles(
      join(checkout, "plugins/core-agents/resources/extensions"),
      "plugins/core-agents/resources/extensions"
    ),
    ...runtimeFiles(
      join(checkout, "plugins/browser/resources/extensions"),
      "plugins/browser/resources/extensions"
    ),
    ...runtimeFiles(
      join(checkout, "plugins/browser/resources/browser/bin"),
      "plugins/browser/resources/browser/bin"
    ),
    "deploy/images/pi-jarvis.Dockerfile",
    "deploy/images/pi-jarvis.Dockerfile.dockerignore",
    "plugins/browser/deploy/browser.Dockerfile",
    "plugins/browser/deploy/browser.Dockerfile.dockerignore",
    "plugins/browser/deploy/install-verified-playwright.mjs",
    "plugins/browser/deploy/playwright-archives.json"
  ].sort()) {
    hash.update(name);
    hash.update("\0");
    hash.update(readFileSync(join(checkout, name)));
    hash.update("\0");
  }
  return {
    repository: "https://github.com/clement-joye/Jarvis",
    revision: revision.stdout.trim(),
    digest: `sha256:${hash.digest("hex")}`
  };
}

function runtimeFiles(directory, relativeRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${relativeRoot}/${entry.name}`;
    if (entry.isDirectory()) return runtimeFiles(join(directory, entry.name), path);
    if (!entry.isFile()) throw new Error(`Runtime source must be a regular file: ${path}`);
    return [path];
  });
}

/**
 * The classifications that the released profile may advertise. They mirror
 * the `compatibility` enum in `ProfileArtifactManifestV1Schema.resources`.
 */
export const COMPATIBILITY_VALUES = Object.freeze([
  "sdk-compatible",
  "interactive-only",
  "host-dependent",
  "unsuitable"
]);

/**
 * Builds the only profile inventory that a runtime profile may advertise.
 * The Dockerfile copies this same allowlist, so manifest and image stay in
 * lockstep instead of relying on a manually duplicated extension list.
 */
export function buildHostLocalReleaseManifest(
  imageId,
  runtimeImageIds = undefined,
  resourceBundle = undefined
) {
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) {
    throw new Error(`A runtime profile requires an immutable image ID: ${imageId}`);
  }
  for (const imageId of Object.values(runtimeImageIds ?? {})) {
    if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) {
      throw new Error(`A runtime profile requires immutable runtime image IDs: ${imageId}`);
    }
  }
  if (resourceBundle) validateResourceBundle(resourceBundle);

  return {
    schemaVersion: 1,
    profileArtifact: {
      schemaVersion: 1,
      id: "pi-jarvis",
      version: "1.0.0",
      source: runtimeSource(),
      runtimeImage: imageId,
      modelsPath: "models.json",
      resources: approvedProfileResources()
    },
    currentRuntime: {
      templateId,
      templateVersion,
      imageId,
      ...(runtimeImageIds ? { runtimeImageIds } : {}),
      ...(resourceBundle ? { resourceBundle } : {}),
      network: "restricted",
      modelNetwork: "restricted"
    }
  };
}

function validateResourceBundle(bundle) {
  if (!bundle || typeof bundle !== "object") {
    throw new Error("A resource bundle must be an object.");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(bundle.digest)) {
    throw new Error(`A resource bundle requires an immutable digest: ${bundle.digest}`);
  }
  if (
    typeof bundle.artifactName !== "string" ||
    !bundle.artifactName ||
    bundle.artifactName.startsWith("/") ||
    bundle.artifactName.includes("\\") ||
    bundle.artifactName
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(
      `A resource bundle requires a release-relative artifact name: ${bundle.artifactName}`
    );
  }
}

function approvedProfileResources() {
  const accepted = readFileSync(acceptedResourcesPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const classification = loadClassification(accepted);
  const resources = accepted.filter(isBaseImageResource).map((path) => {
    const override = classification.resources[path];
    return {
      path,
      kind: resourceKind(path),
      compatibility: override.compatibility,
      rationale: override.rationale
    };
  });

  resources.push({
    path: "node_modules",
    kind: "dependency",
    compatibility: "sdk-compatible",
    rationale: "Locked TypeBox dependency for the core plugin extension."
  });
  return resources;
}

function isBaseImageResource(path) {
  if (/^[^/]+\/(?:AGENTS\.md|skills(?:\/|$))/u.test(path)) return false;
  if (path === "browser/bin" || path.startsWith("extensions/browser/")) return false;
  return true;
}

/**
 * Loads the per-resource classification sidecar. Its keys must exactly match
 * the runtime inventory copied into the reviewed runtime image. Keeping this
 * strict prevents an inventory change from silently acquiring the default
 * `sdk-compatible` classification.
 */
function loadClassification(accepted) {
  const raw = JSON.parse(readFileSync(classificationPath, "utf8"));
  const resources = raw?.resources;
  if (!resources || typeof resources !== "object" || Array.isArray(resources)) {
    throw new Error('classification.json must contain a "resources" object.');
  }

  const classified = Object.keys(resources);
  const missing = accepted.filter((path) => !Object.hasOwn(resources, path));
  const unexpected = classified.filter((path) => !accepted.includes(path));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `classification.json must exactly match accepted-resources.txt (missing: ${
        missing.join(", ") || "none"
      }; unexpected: ${unexpected.join(", ") || "none"}).`
    );
  }

  for (const [path, entry] of Object.entries(resources)) {
    if (!entry || typeof entry !== "object") {
      throw new Error(`classification entry for ${path} must be an object.`);
    }
    if (typeof entry.compatibility !== "string") {
      throw new Error(`classification entry for ${path} is missing "compatibility".`);
    }
    if (!COMPATIBILITY_VALUES.includes(entry.compatibility)) {
      throw new Error(
        `classification entry for ${path} has invalid compatibility "${entry.compatibility}".`
      );
    }
    if (typeof entry.rationale !== "string" || entry.rationale.trim().length === 0) {
      throw new Error(`classification entry for ${path} is missing a non-empty "rationale".`);
    }
  }
  return { resources };
}

function resourceKind(path) {
  if (path.startsWith("extensions/")) return "extension";
  if (path === "skills") return "skill";
  if (
    path === "models.json" ||
    path === "settings.json" ||
    path.startsWith(".pi/") ||
    /^[a-z][a-z0-9-]{0,63}\//.test(path)
  ) {
    return "configuration";
  }
  throw new Error(`Unsupported profile resource in accepted-resources.txt: ${path}`);
}
