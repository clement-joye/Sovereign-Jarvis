#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDockerfileBaseInventory } from "./dockerfile-base-image-inventory.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const images = await buildDockerfileBaseInventory(repositoryRoot);
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      generatedFrom: ["deploy/images/**/*.Dockerfile", "plugins/**/Dockerfile*"],
      images
    },
    null,
    2
  )
);
