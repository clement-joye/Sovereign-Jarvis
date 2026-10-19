import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { HostLocalRuntimeProfileManifestV1Schema } from "@second-brain/contracts";

import {
  resourceOnlyHostLocalReleaseManifest,
  writeCurrentHostLocalRuntimeManifest
} from "../../../../scripts/runtime/build-host-local-profile-release.mjs";
import { buildHostLocalReleaseManifest } from "../../../../scripts/runtime/host-local-profile-release.mjs";

const imageId = `sha256:${"a".repeat(64)}`;
const acceptedResources = readFileSync(
  new URL("../../../../deploy/pi-runtime/accepted-resources.txt", import.meta.url),
  "utf8"
)
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));
const classification = JSON.parse(
  readFileSync(
    new URL("../../../../deploy/pi-runtime/classification.json", import.meta.url),
    "utf8"
  )
) as unknown as { resources: Record<string, Record<string, unknown>> };
const coreSource = new URL("../../../../plugins/core-agents/resources/", import.meta.url);
const browserSource = new URL("../../../../plugins/browser/resources/", import.meta.url);
const baseImageResources = acceptedResources.filter(
  (path) =>
    !/^[^/]+\/(?:AGENTS\.md|skills(?:\/|$))/u.test(path) &&
    path !== "browser/bin" &&
    !path.startsWith("extensions/browser/")
);

describe("host-local profile release manifest", () => {
  it("records executable base-image resources separately from role resources", () => {
    const manifest = buildHostLocalReleaseManifest(imageId);

    expect(manifest.profileArtifact.resources.map((resource) => resource.path)).toEqual([
      ...baseImageResources,
      "node_modules"
    ]);
    expect(Object.keys(classification.resources).sort()).toEqual([...acceptedResources].sort());
    expect(manifest.profileArtifact.modelsPath).toBe("models.json");
    expect(manifest.profileArtifact.source).toMatchObject({
      repository: "https://github.com/clement-joye/Jarvis",
      revision: expect.stringMatching(/^[a-f0-9]{40}$/u),
      digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u)
    });
    expect(manifest.profileArtifact.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "extensions/extra-tools/index.ts", kind: "extension" }),
        expect.objectContaining({ path: "models.json", kind: "configuration" }),
        expect.objectContaining({ path: "node_modules", kind: "dependency" })
      ])
    );
    const coreExtensionClassification = classification.resources["extensions/extra-tools/index.ts"];
    if (!coreExtensionClassification)
      throw new Error("Missing core extension classification fixture.");
    expect(
      manifest.profileArtifact.resources.find(
        (resource) => resource.path === "extensions/extra-tools/index.ts"
      )
    ).toMatchObject(coreExtensionClassification);
    expect(manifest.profileArtifact.resources.map((resource) => resource.path)).not.toContain(
      "extensions/tool-gating/index.ts"
    );
    expect(
      manifest.profileArtifact.resources.every(
        (resource) => resource.compatibility === "sdk-compatible"
      )
    ).toBe(true);
    expect(HostLocalRuntimeProfileManifestV1Schema.parse(manifest)).toEqual(manifest);
  });

  it("rejects mutable or malformed runtime image references", () => {
    expect(() => buildHostLocalReleaseManifest("jarvis/pi-jarvis:latest")).toThrow(
      "immutable image ID"
    );
  });

  it("records an immutable dedicated browser runtime image", () => {
    const browserImageId = `sha256:${"b".repeat(64)}`;
    expect(
      buildHostLocalReleaseManifest(imageId, { browser: browserImageId }).currentRuntime
    ).toMatchObject({ runtimeImageIds: { browser: browserImageId } });
  });

  it("records an optional digest-pinned release-relative resource bundle", () => {
    const resourceBundle = {
      digest: `sha256:${"d".repeat(64)}`,
      artifactName: "role-resources"
    };
    expect(
      buildHostLocalReleaseManifest(imageId, undefined, resourceBundle).currentRuntime
    ).toEqual(expect.objectContaining({ resourceBundle }));
    expect(() =>
      buildHostLocalReleaseManifest(imageId, undefined, {
        digest: resourceBundle.digest,
        artifactName: "/etc/jarvis/roles"
      })
    ).toThrow("release-relative artifact name");
  });

  it("publishes resources while preserving every executable image identity", () => {
    const browserImageId = `sha256:${"b".repeat(64)}`;
    const current = buildHostLocalReleaseManifest(
      imageId,
      { browser: browserImageId },
      {
        digest: `sha256:${"c".repeat(64)}`,
        artifactName: "resource-bundles/old"
      }
    );
    const updated = resourceOnlyHostLocalReleaseManifest(current, {
      digest: `sha256:${"d".repeat(64)}`,
      artifactName: "resource-bundles/new"
    });

    expect(updated.currentRuntime).toMatchObject({
      imageId,
      runtimeImageIds: { browser: browserImageId },
      resourceBundle: {
        digest: `sha256:${"d".repeat(64)}`,
        artifactName: "resource-bundles/new"
      }
    });
    expect(updated.profileArtifact).toEqual(current.profileArtifact);
  });

  it("atomically replaces the one current runtime profile without retaining history", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "jarvis-current-profile-")), "runtime.json");
    writeFileSync(path, JSON.stringify({ obsolete: true }));
    const manifest = buildHostLocalReleaseManifest(imageId);

    await writeCurrentHostLocalRuntimeManifest(path, manifest);

    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(manifest);
  });

  it("includes every local dependency imported by an approved extension", () => {
    const approved = new Set(acceptedResources.filter((path) => path.startsWith("extensions/")));
    const pending = [...approved];

    while (pending.length > 0) {
      const resource = pending.pop();
      if (!resource) continue;
      const resourceRoot = resource.startsWith("extensions/browser/") ? browserSource : coreSource;
      const sourcePath = new URL(resource, resourceRoot);
      if (!existsSync(sourcePath)) continue;
      for (const importedPath of relativeImports(readFileSync(sourcePath, "utf8"))) {
        const imported = relative(
          resourceRoot.pathname,
          resolve(dirname(sourcePath.pathname), importedPath)
        );
        expect(approved, `${resource} imports unapproved ${imported}`).toContain(imported);
      }
    }
  });
});

function relativeImports(source: string): string[] {
  return [...source.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)].map((match) => match[1]!);
}
