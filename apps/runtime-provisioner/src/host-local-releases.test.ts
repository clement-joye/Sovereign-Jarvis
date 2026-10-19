import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { INITIAL_AGENT_CATALOG } from "@second-brain/domain";

import { loadHostLocalRuntimeTemplateCatalog } from "./host-local-releases.js";

describe("host-local runtime releases", () => {
  it("loads only immutable local image IDs from the mounted manifest", () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-release-"));
    const path = join(root, "releases.json");
    const resourcePath = "brain/AGENTS.md";
    const resource = "reviewed prompt\n";
    const digest = createHash("sha256")
      .update(resourcePath)
      .update("\0")
      .update(resource)
      .update("\0")
      .digest("hex");
    mkdirSync(join(root, "role-resources/brain"), { recursive: true });
    writeFileSync(join(root, "role-resources/brain/AGENTS.md"), resource);
    writeFileSync(
      join(root, "role-resources/resource-bundle.json"),
      JSON.stringify({ schemaVersion: 1, digest: `sha256:${digest}`, files: [resourcePath] })
    );
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: 1,
        profileArtifact: artifact(),
        currentRuntime: {
          templateId: "code-project",
          templateVersion: "1.0.0",
          imageId: `sha256:${"a".repeat(64)}`,
          runtimeImageIds: { browser: `sha256:${"b".repeat(64)}` },
          resourceBundle: {
            digest: `sha256:${digest}`,
            artifactName: "role-resources"
          },
          network: "restricted",
          modelNetwork: "restricted"
        }
      })
    );

    expect(
      loadHostLocalRuntimeTemplateCatalog({ RUNTIME_CURRENT_PROFILE_PATH: path }).get(
        "code-project",
        "1.0.0"
      )
    ).toMatchObject({
      specification: {
        image: `sha256:${"a".repeat(64)}`,
        runtimeImages: { browser: `sha256:${"b".repeat(64)}` },
        resourceBundle: {
          digest: `sha256:${digest}`,
          artifactName: "role-resources"
        },
        network: "restricted",
        modelNetwork: "restricted"
      }
    });
    expect(() =>
      loadHostLocalRuntimeTemplateCatalog(
        { RUNTIME_CURRENT_PROFILE_PATH: path },
        INITIAL_AGENT_CATALOG
      )
    ).toThrow("does not match platform catalog");
  });

  it("keeps dynamic runtime provisioning disabled without a mounted release manifest", () => {
    expect(loadHostLocalRuntimeTemplateCatalog({}).get("code-project", "1.0.0")).toBeUndefined();
  });

  it("accepts a resource bundle digest bound to the platform catalog", () => {
    const { path, digest } = writeReleaseWithBundle("bound");

    expect(() =>
      loadHostLocalRuntimeTemplateCatalog({ RUNTIME_CURRENT_PROFILE_PATH: path }, undefined, digest)
    ).not.toThrow();
  });

  it("rejects a runtime release whose resource bundle digest is not bound to the platform catalog", () => {
    const { path } = writeReleaseWithBundle("mismatched");

    expect(() =>
      loadHostLocalRuntimeTemplateCatalog(
        { RUNTIME_CURRENT_PROFILE_PATH: path },
        undefined,
        `sha256:${"f".repeat(64)}`
      )
    ).toThrow("does not match platform catalog");
  });

  it("rejects a release missing its resource bundle when the platform catalog requires one", () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-release-missing-bundle-"));
    const path = join(root, "releases.json");
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: 1,
        profileArtifact: artifact(),
        currentRuntime: {
          templateId: "code-project",
          templateVersion: "1.0.0",
          imageId: `sha256:${"a".repeat(64)}`,
          network: "restricted",
          modelNetwork: "restricted"
        }
      })
    );

    expect(() =>
      loadHostLocalRuntimeTemplateCatalog(
        { RUNTIME_CURRENT_PROFILE_PATH: path },
        undefined,
        `sha256:${"d".repeat(64)}`
      )
    ).toThrow("does not match platform catalog");
  });

  it("keeps legacy releases readable when no platform resource digest is supplied", () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-release-legacy-"));
    const path = join(root, "releases.json");
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: 1,
        profileArtifact: artifact(),
        currentRuntime: {
          templateId: "code-project",
          templateVersion: "1.0.0",
          imageId: `sha256:${"a".repeat(64)}`,
          network: "restricted",
          modelNetwork: "restricted"
        }
      })
    );

    expect(() =>
      loadHostLocalRuntimeTemplateCatalog({ RUNTIME_CURRENT_PROFILE_PATH: path })
    ).not.toThrow();
  });

  it("rejects a release whose resource bundle content was tampered with", () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-release-tampered-"));
    const path = join(root, "releases.json");
    const resourcePath = "brain/AGENTS.md";
    const digest = createHash("sha256")
      .update(resourcePath)
      .update("\0")
      .update("reviewed prompt\n")
      .update("\0")
      .digest("hex");
    mkdirSync(join(root, "role-resources/brain"), { recursive: true });
    writeFileSync(join(root, "role-resources/brain/AGENTS.md"), "tampered prompt\n");
    writeFileSync(
      join(root, "role-resources/resource-bundle.json"),
      JSON.stringify({ schemaVersion: 1, digest: `sha256:${digest}`, files: [resourcePath] })
    );
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: 1,
        profileArtifact: artifact(),
        currentRuntime: {
          templateId: "code-project",
          templateVersion: "1.0.0",
          imageId: `sha256:${"a".repeat(64)}`,
          resourceBundle: { digest: `sha256:${digest}`, artifactName: "role-resources" },
          network: "restricted",
          modelNetwork: "restricted"
        }
      })
    );

    expect(() =>
      loadHostLocalRuntimeTemplateCatalog({ RUNTIME_CURRENT_PROFILE_PATH: path })
    ).toThrow("content does not match");
  });
});

function writeReleaseWithBundle(name: string): { path: string; digest: string } {
  const root = mkdtempSync(join(tmpdir(), `jarvis-release-${name}-`));
  const path = join(root, "releases.json");
  const resourcePath = "brain/AGENTS.md";
  const resource = `${name} prompt\n`;
  const digest = `sha256:${createHash("sha256")
    .update(resourcePath)
    .update("\0")
    .update(resource)
    .update("\0")
    .digest("hex")}`;
  mkdirSync(join(root, "role-resources/brain"), { recursive: true });
  writeFileSync(join(root, "role-resources/brain/AGENTS.md"), resource);
  writeFileSync(
    join(root, "role-resources/resource-bundle.json"),
    JSON.stringify({ schemaVersion: 1, digest, files: [resourcePath] })
  );
  writeFileSync(
    path,
    JSON.stringify({
      schemaVersion: 1,
      profileArtifact: artifact(),
      currentRuntime: {
        templateId: "code-project",
        templateVersion: "1.0.0",
        imageId: `sha256:${"a".repeat(64)}`,
        resourceBundle: { digest, artifactName: "role-resources" },
        network: "restricted",
        modelNetwork: "restricted"
      }
    })
  );
  return { path, digest };
}

function artifact() {
  return {
    schemaVersion: 1,
    id: "pi-jarvis",
    version: "1.0.0",
    source: {
      repository: "https://example.test/profile",
      revision: "b".repeat(40),
      digest: `sha256:${"c".repeat(64)}`
    },
    runtimeImage: `sha256:${"a".repeat(64)}`,
    modelsPath: "models.json",
    resources: [
      {
        path: "skills",
        kind: "skill",
        compatibility: "sdk-compatible",
        rationale: "Reviewed skills."
      }
    ]
  };
}
