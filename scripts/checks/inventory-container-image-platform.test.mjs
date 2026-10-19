import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { inventoryImage, resolvePlatformManifest } from "./inventory-container-image-platform.mjs";

const rawIndex = JSON.stringify({
  schemaVersion: 2,
  mediaType: "application/vnd.oci.image.index.v1+json",
  manifests: [
    {
      digest: `sha256:${"b".repeat(64)}`,
      platform: { os: "linux", architecture: "amd64" }
    },
    {
      digest: `sha256:${"c".repeat(64)}`,
      platform: { os: "linux", architecture: "arm64", variant: "v8" }
    }
  ]
});
const indexDigest = createHash("sha256").update(rawIndex).digest("hex");
const image = `registry.example/image@sha256:${indexDigest}`;

test("records exact immutable image, platform, Syft version and package inventory", () => {
  const calls = [];
  const result = inventoryImage(
    (command, args, options) => {
      calls.push([command, args, options]);
      if (command === "docker") return rawIndex;
      return args[0] === "version"
        ? "syft 1.0.0"
        : JSON.stringify({ artifacts: [{ name: "libc" }] });
    },
    image,
    "linux/amd64"
  );
  assert.equal(result.inventoryToolVersion, "syft 1.0.0");
  assert.equal(result.image, image);
  assert.equal(result.scannedImage, `registry.example/image@sha256:${"b".repeat(64)}`);
  assert.equal(result.platform, "linux/amd64");
  assert.equal(result.indexManifestDigest, `sha256:${indexDigest}`);
  assert.equal(result.platformManifestDigest, `sha256:${"b".repeat(64)}`);
  assert.deepEqual(result.platformDescriptor, { os: "linux", architecture: "amd64" });
  assert.deepEqual(result.syft.artifacts, [{ name: "libc" }]);
  assert.equal(
    result.reviewStatus,
    "package-inventory-generated-license-and-notice-review-required"
  );
  assert.deepEqual(calls[0].slice(0, 2), [
    "docker",
    ["buildx", "imagetools", "inspect", "--raw", image]
  ]);
  assert.deepEqual(calls[2].slice(0, 2), [
    "syft",
    [`registry.example/image@sha256:${"b".repeat(64)}`, "-o", "syft-json"]
  ]);
  assert.equal(calls[0][2].timeout, 60 * 1000);
  for (const [, , options] of calls.slice(1)) {
    assert.equal(options.maxBuffer, 64 * 1024 * 1024);
    assert.equal(options.timeout, 5 * 60 * 1000);
    assert.deepEqual(options.stdio, ["ignore", "pipe", "ignore"]);
  }
});

test("rejects mutable references and unsupported platforms before invoking Syft", () => {
  let called = false;
  const exec = () => {
    called = true;
  };
  assert.throws(() => inventoryImage(exec, "postgres:16", "linux/amd64"), /immutable sha256/);
  assert.throws(() => inventoryImage(exec, image, "linux/s390x"), /Platform/);
  assert.equal(called, false);
});

test("resolves the exact platform child manifest and verifies the index bytes", () => {
  const resolution = resolvePlatformManifest(() => rawIndex, image, "linux/arm64");
  assert.equal(resolution.indexManifestDigest, `sha256:${indexDigest}`);
  assert.equal(resolution.platformManifestDigest, `sha256:${"c".repeat(64)}`);
  assert.deepEqual(resolution.platformDescriptor, {
    os: "linux",
    architecture: "arm64",
    variant: "v8"
  });
  assert.throws(
    () =>
      resolvePlatformManifest(
        () => rawIndex,
        `registry.example/image@sha256:${"d".repeat(64)}`,
        "linux/amd64"
      ),
    /do not match/u
  );
});

test("rejects duplicate or missing platform descriptors", () => {
  const duplicateIndex = JSON.stringify({
    manifests: [
      { digest: `sha256:${"b".repeat(64)}`, platform: { os: "linux", architecture: "amd64" } },
      { digest: `sha256:${"c".repeat(64)}`, platform: { os: "linux", architecture: "amd64" } }
    ]
  });
  const duplicateImage = `registry.example/image@sha256:${createHash("sha256").update(duplicateIndex).digest("hex")}`;
  assert.throws(
    () => resolvePlatformManifest(() => duplicateIndex, duplicateImage, "linux/amd64"),
    /exactly one/u
  );
});

test("suppresses subprocess details that could contain registry credential data", () => {
  assert.throws(
    () =>
      inventoryImage(
        (command) => {
          if (command === "docker") return rawIndex;
          throw new Error("sensitive credential echoed by syft");
        },
        image,
        "linux/arm64"
      ),
    (error) =>
      error.message ===
      "Syft could not inventory the selected image. Check registry access and the image reference."
  );
});
