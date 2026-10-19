#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getExternalImages,
  makeRecords,
  missingExpectedImageServices,
  observabilityVariables,
  parseEnv,
  runComposeConfig,
  validateImageReference
} from "./container-image-provenance.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const envFile = process.argv[2];

if (!envFile || process.argv.length !== 3) {
  console.error(
    "Usage: node scripts/checks/audit-container-image-provenance.mjs <production-env-file>"
  );
  process.exit(2);
}

let env;
try {
  env = parseEnv(await readFile(resolve(envFile), "utf8"));
} catch {
  console.error("Could not read or parse the supplied production environment file.");
  process.exit(1);
}
const observabilitySelections = observabilityVariables.filter((key) => env[key]);
if (
  observabilitySelections.length !== 0 &&
  observabilitySelections.length !== observabilityVariables.length
) {
  console.error("Set all four observability image references together, or leave all four unset.");
  process.exit(1);
}

const composeArgs = [
  "compose",
  "--project-name",
  "jarvis-image-provenance",
  "--env-file",
  resolve(envFile),
  "-f",
  "deploy/compose/compose.production.yml"
];
if (observabilitySelections.length > 0) {
  composeArgs.push("-f", "deploy/compose/compose.observability.yml");
}
composeArgs.push("config", "--format", "json");

let resolvedCompose;
try {
  resolvedCompose = runComposeConfig(execFileSync, composeArgs, repositoryRoot);
} catch {
  console.error("Could not resolve the selected production Compose images.");
  process.exit(1);
}

const images = getExternalImages(resolvedCompose.services ?? {});

const errors = [];
for (const service of missingExpectedImageServices(
  resolvedCompose.services ?? {},
  observabilitySelections.length > 0
)) {
  errors.push(`Expected image service ${service} is missing.`);
}
for (const image of images) {
  if (!image.reference) {
    errors.push(`${image.service} has no resolved image reference.`);
    continue;
  }
  if (!validateImageReference(image.reference)) {
    errors.push(
      `${image.variable ?? image.service} must be an image@sha256:<64 lowercase hex> reference.`
    );
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      generatedFrom: [
        "deploy/compose/compose.base.yml",
        "deploy/compose/compose.production.yml",
        "deploy/compose/compose.production.overlay.yml",
        ...(observabilitySelections.length > 0 ? ["deploy/compose/compose.observability.yml"] : [])
      ],
      images: makeRecords(images)
    },
    null,
    2
  )
);
