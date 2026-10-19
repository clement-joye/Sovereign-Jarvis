import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const platforms = new Set(["linux/amd64", "linux/arm64"]);
export const immutableImage = /^\S+@sha256:[a-f0-9]{64}$/;
export const syftProcessLimits = {
  maxBuffer: 64 * 1024 * 1024,
  timeout: 5 * 60 * 1000
};

const syftExecOptions = {
  ...syftProcessLimits,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"]
};

const manifestExecOptions = {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
  timeout: 60 * 1000,
  maxBuffer: 16 * 1024 * 1024
};

export function resolvePlatformManifest(exec, image, platform) {
  const match = /^\S+@sha256:([a-f0-9]{64})$/.exec(image ?? "");
  if (!match) throw new Error("Image must be an immutable sha256 reference.");
  if (!platforms.has(platform)) throw new Error("Platform must be linux/amd64 or linux/arm64.");

  let rawManifest;
  try {
    rawManifest = exec(
      "docker",
      ["buildx", "imagetools", "inspect", "--raw", image],
      manifestExecOptions
    );
  } catch {
    throw new Error("Docker could not resolve the selected image manifest. Check registry access.");
  }

  let manifest;
  try {
    manifest = JSON.parse(rawManifest);
  } catch {
    throw new Error("Docker returned invalid registry manifest JSON.");
  }
  const indexDigest = `sha256:${createHash("sha256").update(rawManifest).digest("hex")}`;
  if (indexDigest !== `sha256:${match[1]}`) {
    throw new Error("Registry manifest bytes do not match the requested image digest.");
  }
  if (!Array.isArray(manifest.manifests)) {
    throw new Error("Selected image digest is not a multi-platform image index.");
  }

  const [os, architecture] = platform.split("/");
  const candidates = manifest.manifests.filter(
    (entry) => entry.platform?.os === os && entry.platform?.architecture === architecture
  );
  if (candidates.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(candidates[0]?.digest ?? "")) {
    throw new Error(
      "Registry index must contain exactly one valid manifest for the requested platform."
    );
  }
  return {
    indexManifestDigest: indexDigest,
    platformManifestDigest: candidates[0].digest,
    platformDescriptor: candidates[0].platform
  };
}

export function inventoryImage(exec, image, platform) {
  if (!immutableImage.test(image ?? "")) {
    throw new Error("Image must be an immutable sha256 reference.");
  }
  if (!platforms.has(platform)) throw new Error("Platform must be linux/amd64 or linux/arm64.");

  const manifest = resolvePlatformManifest(exec, image, platform);
  const platformImage = `${image.slice(0, image.lastIndexOf("@sha256:"))}@${manifest.platformManifestDigest}`;

  let version;
  let sbom;
  try {
    version = exec("syft", ["version"], syftExecOptions).trim();
    sbom = exec("syft", [platformImage, "-o", "syft-json"], { ...syftExecOptions });
  } catch {
    throw new Error(
      "Syft could not inventory the selected image. Check registry access and the image reference."
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(sbom);
  } catch {
    throw new Error("Syft returned invalid inventory JSON.");
  }
  return {
    inventoryTool: "Syft",
    inventoryToolVersion: version,
    image,
    scannedImage: platformImage,
    platform,
    ...manifest,
    inspectedAt: new Date().toISOString(),
    syft: parsed,
    reviewStatus: "package-inventory-generated-license-and-notice-review-required"
  };
}

export function main(args = process.argv.slice(2), exec = execFileSync) {
  const [image, platform, output] = args;
  if (args.length !== 3 || !output) {
    throw new Error(
      "Usage: node scripts/checks/inventory-container-image-platform.mjs <digest-pinned-image> <linux/amd64|linux/arm64> <output.json>"
    );
  }
  const result = inventoryImage(exec, image, platform);
  writeFileSync(resolve(output), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
