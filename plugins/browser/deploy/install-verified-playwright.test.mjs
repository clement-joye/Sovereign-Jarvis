import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";

import { installVerifiedArchives, selectPlatformArchives } from "./install-verified-playwright.mjs";

const manifest = JSON.parse(await readFile(new URL("./playwright-archives.json", import.meta.url)));
const packageManifest = { dependencies: { playwright: "1.59.1" } };
const browsers = {
  browsers: [
    { name: "chromium", revision: "1217", browserVersion: "147.0.7727.15" },
    { name: "chromium-headless-shell", revision: "1217", browserVersion: "147.0.7727.15" },
    { name: "ffmpeg", revision: "1011" }
  ]
};

test("the reviewed archives agree with the pinned Playwright package and both Linux platforms", () => {
  for (const architecture of ["x64", "arm64"]) {
    const entries = selectPlatformArchives(manifest, packageManifest, browsers, architecture);
    assert.deepEqual(
      entries.map((entry) => entry.name),
      ["chromium", "chromium-headless-shell", "ffmpeg"]
    );
  }
  assert.throws(
    () =>
      selectPlatformArchives(manifest, { dependencies: { playwright: "other" } }, browsers, "x64"),
    /disagree/u
  );
  assert.throws(
    () => selectPlatformArchives(manifest, packageManifest, browsers, "s390x"),
    /Unsupported/u
  );
  assert.throws(
    () =>
      selectPlatformArchives(
        {
          ...manifest,
          platforms: {
            ...manifest.platforms,
            "linux/amd64": [
              { ...manifest.platforms["linux/amd64"][0], sha256: "bad" },
              ...manifest.platforms["linux/amd64"].slice(1)
            ]
          }
        },
        packageManifest,
        browsers,
        "x64"
      ),
    /Invalid reviewed/u
  );
});

test("Playwright receives only the checked archive bytes from the local verifier", async () => {
  const content = new Map([
    ["chromium", Buffer.from("browser bytes")],
    ["chromium-headless-shell", Buffer.from("headless bytes")],
    ["ffmpeg", Buffer.from("ffmpeg bytes")]
  ]);
  const entries = [...content].map(([name, bytes]) => ({
    name,
    path: `builds/test/${name}.zip`,
    sourceUrl: `https://cdn.playwright.dev/builds/test/${name}.zip`,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex")
  }));
  await installVerifiedArchives(entries, {
    download: async (url, path) => {
      const name = url.split("/").at(-1).replace(".zip", "");
      await writeFile(path, content.get(name), { flag: "wx" });
    },
    install: async (baseUrl) => {
      for (const entry of entries) {
        const response = await fetch(`${baseUrl}/${entry.path}`);
        assert.equal(response.status, 200);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), content.get(entry.name));
      }
      const unexpected = await fetch(`${baseUrl}/builds/test/unreviewed.zip`);
      assert.equal(unexpected.status, 404);
    },
    output: () => undefined
  });
});

test("a changed archive aborts before the installer runs", async () => {
  let installed = false;
  await assert.rejects(
    installVerifiedArchives(
      [
        {
          name: "chromium",
          path: "builds/test/chromium.zip",
          sourceUrl: "https://cdn.playwright.dev/builds/test/chromium.zip",
          bytes: 8,
          sha256: createHash("sha256").update("expected").digest("hex")
        }
      ],
      {
        download: async (_url, path) => writeFile(path, "tampered", { flag: "wx" }),
        install: async () => {
          installed = true;
        },
        output: () => undefined
      }
    ),
    /failed its reviewed SHA-256/u
  );
  assert.equal(installed, false);
});
