import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  compileCorePlatformCatalogReleaseFromResources,
  serializePlatformCatalogRelease,
  verifyPlatformCatalogReleaseArtifact,
  writePlatformCatalogReleaseArtifact
} from "./core-platform-catalog-release.js";
import {
  INSTALLED_PLUGIN_MANIFESTS_V2,
  type InstalledRuntimeImagePinsV2
} from "@second-brain/installed-plugins/catalog";

const CORE_PLUGIN_MANIFEST_V2 = INSTALLED_PLUGIN_MANIFESTS_V2.find(
  ({ id }) => id === "core-agents"
)!;

const EXAMPLE_ECHO_PLUGIN_MANIFEST_V2 = INSTALLED_PLUGIN_MANIFESTS_V2.find(
  ({ id }) => id === "example-echo"
)!;
const BROWSER_PLUGIN_MANIFEST_V2 = INSTALLED_PLUGIN_MANIFESTS_V2.find(
  ({ id }) => id === "browser"
)!;

const pin = (hex: string) => `sha256:${hex.repeat(64)}`;
const runtimeImages: InstalledRuntimeImagePinsV2 = {
  base: pin("a"),
  browser: pin("b"),
  isolated: pin("c")
};
const resources = new Map<string, string>();
for (const agent of [
  CORE_PLUGIN_MANIFEST_V2,
  BROWSER_PLUGIN_MANIFEST_V2,
  EXAMPLE_ECHO_PLUGIN_MANIFEST_V2
].flatMap((manifest) => manifest.agents)) {
  resources.set(agent.promptPath, `reviewed prompt: ${agent.promptPath}`);
  for (const root of agent.skillPaths) {
    resources.set(`${root}/SKILL.md`, `reviewed skill: ${root}`);
  }
  for (const path of agent.extensionPaths) {
    resources.set(path, `reviewed extension: ${path}`);
  }
}

describe("core platform catalog release", () => {
  it("reproducibly compiles an injected reviewed resource inventory", () => {
    const first = compileCorePlatformCatalogReleaseFromResources(runtimeImages, resources);
    const second = compileCorePlatformCatalogReleaseFromResources(runtimeImages, resources);

    expect(serializePlatformCatalogRelease(first)).toBe(serializePlatformCatalogRelease(second));
    expect(first.digest).toBe(second.digest);
    expect(first.plugins).toHaveLength(3);
    expect(first.plugins.map(({ id }) => id)).toEqual(["browser", "core-agents", "example-echo"]);
    expect(first.agents).toHaveLength(7);
    expect(first.plugins.find(({ id }) => id === "browser")?.activation).toBe("workspace");
    expect(first.runtimeClasses.map(({ id, image }) => ({ id, image }))).toEqual([
      { id: "base", image: runtimeImages.base },
      { id: "browser", image: runtimeImages.browser },
      { id: "isolated", image: runtimeImages.isolated }
    ]);
  });

  it("atomically writes and rebuild-verifies the exact release bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "core-platform-catalog-release-"));
    const outputPath = join(directory, "release", "platform-catalog.v2.json");
    try {
      const written = compileCorePlatformCatalogReleaseFromResources(runtimeImages, resources);
      await writePlatformCatalogReleaseArtifact(outputPath, written);
      const original = await readFile(outputPath, "utf8");
      expect(original).toBe(serializePlatformCatalogRelease(written));
      await expect(verifyPlatformCatalogReleaseArtifact(outputPath, written)).resolves.toEqual(
        written
      );
      expect(await readdir(join(directory, "release"))).toEqual(["platform-catalog.v2.json"]);

      await writeFile(outputPath, JSON.stringify(written));
      await expect(verifyPlatformCatalogReleaseArtifact(outputPath, written)).rejects.toThrow(
        "does not match current tracked inputs"
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects an artifact rebuilt against different runtime pins", async () => {
    const directory = await mkdtemp(join(tmpdir(), "core-platform-catalog-release-"));
    const outputPath = join(directory, "platform-catalog.v2.json");
    try {
      const written = compileCorePlatformCatalogReleaseFromResources(runtimeImages, resources);
      await writePlatformCatalogReleaseArtifact(outputPath, written);
      const expected = compileCorePlatformCatalogReleaseFromResources(
        { ...runtimeImages, isolated: pin("d") },
        resources
      );
      await expect(verifyPlatformCatalogReleaseArtifact(outputPath, expected)).rejects.toThrow(
        "does not match current tracked inputs"
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
