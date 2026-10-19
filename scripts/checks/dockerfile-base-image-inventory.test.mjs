import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  buildDockerfileBaseInventory,
  parseDockerfileBaseInputs
} from "./dockerfile-base-image-inventory.mjs";

test("inventory records frontend, direct bases, ARG defaults, and internal stages distinctly", () => {
  const records = parseDockerfileBaseInputs(
    [
      "# syntax=docker/dockerfile:1.7",
      "ARG BASE_IMAGE=registry.example/runtime:24",
      "FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS build",
      "FROM ${BASE_IMAGE} AS runtime",
      "FROM build AS test"
    ].join("\n"),
    "Dockerfile"
  );

  assert.deepEqual(
    records.map(({ kind, sourceExpression, resolvedReference, resolution, pinStatus }) => ({
      kind,
      sourceExpression,
      resolvedReference,
      resolution,
      pinStatus
    })),
    [
      {
        kind: "dockerfile-frontend",
        sourceExpression: "docker/dockerfile:1.7",
        resolvedReference: "docker/dockerfile:1.7",
        resolution: "direct",
        pinStatus: "mutable-reference"
      },
      {
        kind: "from-image",
        sourceExpression: "node:24-bookworm-slim",
        resolvedReference: "node:24-bookworm-slim",
        resolution: "direct",
        pinStatus: "mutable-reference"
      },
      {
        kind: "from-image",
        sourceExpression: "${BASE_IMAGE}",
        resolvedReference: "registry.example/runtime:24",
        resolution: "global-arg-default; build-time override may differ",
        pinStatus: "mutable-reference"
      },
      {
        kind: "build-stage-reference",
        sourceExpression: "build",
        resolvedReference: null,
        resolution: "internal-stage",
        pinStatus: null
      }
    ]
  );
});

test("inventory flags ARG references without defaults as unresolved", () => {
  const [record] = parseDockerfileBaseInputs("ARG BASE_IMAGE\nFROM $BASE_IMAGE\n", "Dockerfile");
  assert.equal(record.resolvedReference, null);
  assert.equal(record.resolution, "build-arg-value-required");
  assert.equal(record.pinStatus, "unresolved");
});

test("repository inventory is sorted, local-only, and captures pinned production Dockerfiles", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const inventory = await buildDockerfileBaseInventory(root);
  const files = [...new Set(inventory.map(({ file }) => file))];

  assert.deepEqual(
    files,
    [...files].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  );
  assert.equal(files.includes("deploy/images/media-worker.Dockerfile"), true);
  assert.equal(files.includes("plugins/browser/deploy/browser.Dockerfile"), true);
  const mutableReferences = inventory.filter(({ pinStatus }) => pinStatus === "mutable-reference");
  assert.deepEqual(
    mutableReferences.map(({ file, sourceExpression, resolvedReference }) => ({
      file,
      sourceExpression,
      resolvedReference
    })),
    [
      {
        file: "plugins/browser/deploy/browser.Dockerfile",
        sourceExpression: "${BASE_RUNTIME_IMAGE}",
        resolvedReference: "jarvis/pi-jarvis:current"
      }
    ]
  );
  assert.equal(
    inventory
      .filter(({ kind }) => kind === "dockerfile-frontend")
      .every(
        ({ pinStatus, resolvedReference }) =>
          pinStatus === "digest-pinned" &&
          resolvedReference.endsWith(
            "@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e"
          )
      ),
    true
  );
  assert.equal(
    inventory
      .filter(({ sourceExpression }) => sourceExpression.startsWith("node:"))
      .every(({ resolvedReference }) =>
        resolvedReference.endsWith(
          "@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6"
        )
      ),
    true
  );
  assert.equal(
    inventory
      .filter(({ sourceExpression }) => sourceExpression.startsWith("debian:"))
      .every(({ resolvedReference }) =>
        resolvedReference.endsWith(
          "@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251"
        )
      ),
    true
  );
  assert.equal(
    inventory
      .filter(({ sourceExpression }) => sourceExpression.startsWith("alpine:"))
      .every(({ resolvedReference }) =>
        resolvedReference.endsWith(
          "@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc"
        )
      ),
    true
  );
  assert.equal(
    inventory.some(
      ({ kind, sourceExpression }) =>
        kind === "from-image" && ["base", "deps", "build"].includes(sourceExpression)
    ),
    false
  );
  assert.equal(
    inventory.every(({ file }) => !file.startsWith("/")),
    true
  );
});
