import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const profileDirectory = new URL("../../deploy/pi-runtime/", import.meta.url);
const supportedRuntimeClasses = new Set(["base", "isolated", "browser"]);

const probe = String.raw`
  import { readdir, readFile } from "node:fs/promises";
  const deployedPackage = (await readdir("/app/node_modules/.pnpm")).find((entry) =>
    entry.startsWith("@earendil-works+pi-coding-agent@")
  );
  if (!deployedPackage) throw new Error("Pi SDK is missing from the deployed runtime.");
  const { DefaultResourceLoader } = await import(
    "/app/node_modules/.pnpm/" + deployedPackage +
      "/node_modules/@earendil-works/pi-coding-agent/dist/index.js"
  );
  const loader = new DefaultResourceLoader({
    cwd: "/workspace",
    agentDir: "/sessions/probe",
    additionalExtensionPaths: JSON.parse(process.argv[1]),
    noContextFiles: true
  });
  await loader.reload();
  const extensions = loader.getExtensions();
  const models = JSON.parse(await readFile("/opt/profile/models.json", "utf8"));
  console.log(JSON.stringify({
    extensions: extensions.extensions.map((entry) => entry.path).sort(),
    extensionErrors: extensions.errors.map((entry) => entry.error),
    modelCount: Object.values(models.providers).flatMap((provider) => provider.models).length
  }));
`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

function main() {
  const image = readRequiredOption("--image");
  const runtimeClass = readRequiredOption("--runtime-class");
  const acceptedResources = readFileSync(
    new URL("accepted-resources.txt", profileDirectory),
    "utf8"
  );
  const expectedExtensions = expectedRuntimeExtensions(acceptedResources, runtimeClass);
  const result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--network",
      "none",
      "--entrypoint",
      "/usr/bin/timeout",
      image,
      "25s",
      "node",
      "--input-type=module",
      "-e",
      probe,
      JSON.stringify(expectedExtensions)
    ],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(
      `Profile SDK probe failed: ${result.stderr || result.stdout || "unknown error"}`
    );
  }

  const report = JSON.parse(result.stdout.trim());
  if (JSON.stringify(report.extensions) !== JSON.stringify(expectedExtensions)) {
    throw new Error(
      `Unexpected loaded extensions for ${runtimeClass}: expected ${JSON.stringify(expectedExtensions)}, received ${JSON.stringify(report.extensions)}`
    );
  }
  if (report.extensionErrors.length > 0) {
    throw new Error(
      `Profile extensions reported errors: ${JSON.stringify(report.extensionErrors)}`
    );
  }
  if (report.modelCount === 0) {
    throw new Error("Reviewed model definition was not loaded.");
  }
  process.stdout.write(`Verified host-local ${runtimeClass} runtime: ${image}\n`);
}

/** Returns the exact executable extension inventory for one reviewed runtime class. */
export function expectedRuntimeExtensions(acceptedResources, runtimeClass) {
  if (!supportedRuntimeClasses.has(runtimeClass)) {
    throw new Error(`Unsupported host-local runtime class: ${runtimeClass}`);
  }
  return acceptedResources
    .split("\n")
    .map((line) => line.trim())
    .filter((path) => /^extensions\/[^/]+\/index\.ts$/u.test(path))
    .filter((path) =>
      runtimeClass === "browser"
        ? path === "extensions/browser/index.ts"
        : path === "extensions/extra-tools/index.ts"
    )
    .map((path) => `/opt/profile/${path}`)
    .sort();
}

function readRequiredOption(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(
      "Usage: verify-host-local-profile-runtime.mjs --image <image-id-or-tag> --runtime-class <base|isolated|browser>"
    );
  }
  return value;
}
