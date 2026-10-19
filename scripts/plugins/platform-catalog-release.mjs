import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  verifyCorePlatformCatalogRelease,
  writeCorePlatformCatalogRelease
} from "../../packages/platform-catalog/src/index.ts";

const USAGE = `Usage:
  pnpm catalog:build -- --output <catalog.json> [runtime image options]
  pnpm catalog:verify -- --output <catalog.json> [runtime image options]

Options and equivalent environment variables:
  --output <path>             PLATFORM_CATALOG_PATH
  --runtime-image <id>=<pin>  repeat for every installed runtime class
                               (or PLATFORM_CATALOG_RUNTIME_IMAGES JSON)
  --repo-root <path>          repository root (defaults to this script's parent)

Every runtime pin must be an immutable sha256:<64 lowercase hex> image ID or
an image-name@sha256:<64 lowercase hex> digest reference.`;

await main();

async function main() {
  const command = process.argv[2];
  if (command !== "build" && command !== "verify") failUsage(`Unknown command: ${command ?? ""}`);

  const optionArgs = process.argv.slice(3);
  if (optionArgs[0] === "--") optionArgs.shift();
  const args = parseOptions(optionArgs);
  const artifactPath = requiredValue(args.values, "output", "PLATFORM_CATALOG_PATH");
  const repoRoot = resolve(
    args.values.get("repo-root") ?? fileURLToPath(new URL("../..", import.meta.url))
  );
  const input = {
    repoRoot,
    runtimeImages: runtimeImages(args.runtimeImages)
  };

  const catalog =
    command === "build"
      ? await writeCorePlatformCatalogRelease(artifactPath, input)
      : await verifyCorePlatformCatalogRelease(artifactPath, input);
  process.stdout.write(
    `${command === "build" ? "Built" : "Verified"} platform catalog ${catalog.digest}: ${resolve(artifactPath)}\n`
  );
}

function parseOptions(argv) {
  const values = new Map();
  const runtimeImages = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!option?.startsWith("--") || !value || value.startsWith("--")) {
      failUsage(`Invalid option near: ${option ?? ""}`);
    }
    const name = option.slice(2);
    if (!["output", "runtime-image", "repo-root"].includes(name)) {
      failUsage(`Unknown option: ${option}`);
    }
    if (name === "runtime-image") {
      const separator = value.indexOf("=");
      const id = separator > 0 ? value.slice(0, separator) : "";
      const image = separator > 0 ? value.slice(separator + 1) : "";
      if (!/^[a-z][a-z0-9-]{0,63}$/u.test(id) || !image || runtimeImages.has(id)) {
        failUsage(`Invalid or duplicate runtime image: ${value}`);
      }
      runtimeImages.set(id, image);
      continue;
    }
    if (values.has(name)) failUsage(`Duplicate option: ${option}`);
    values.set(name, value);
  }
  return { values, runtimeImages };
}

function runtimeImages(options) {
  if (options.size > 0) return Object.fromEntries(options);
  const value = process.env.PLATFORM_CATALOG_RUNTIME_IMAGES;
  if (!value) failUsage("Missing --runtime-image or PLATFORM_CATALOG_RUNTIME_IMAGES");
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    failUsage("PLATFORM_CATALOG_RUNTIME_IMAGES must be a JSON object");
  }
  return parsed;
}

function requiredValue(options, option, env) {
  const value = options.get(option) ?? process.env[env];
  if (!value) failUsage(`Missing --${option} or ${env}`);
  return value;
}

function failUsage(message) {
  throw new Error(`${message}\n\n${USAGE}`);
}
