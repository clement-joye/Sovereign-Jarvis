import { describe, expect, it } from "vitest";

import { ProfileArtifactCatalog } from "./profile-artifacts.js";

const artifact = {
  schemaVersion: 1 as const,
  id: "pi-jarvis",
  version: "1.0.0",
  source: {
    repository: "https://github.com/clement-joye/pi-local-profile",
    revision: "a".repeat(40),
    digest: `sha256:${"b".repeat(64)}`
  },
  runtimeImage: `jarvis/code-runtime@sha256:${"c".repeat(64)}`,
  modelsPath: "models.json",
  resources: [
    {
      path: "extensions/tool-gating/index.ts",
      kind: "extension" as const,
      compatibility: "sdk-compatible" as const,
      rationale: "Uses SDK hooks and a fixed policy allowlist."
    }
  ]
};

describe("ProfileArtifactCatalog", () => {
  it("selects only pinned reviewed artifacts", () => {
    const catalog = new ProfileArtifactCatalog([artifact]);
    expect(catalog.get("pi-jarvis", "1.0.0")).toMatchObject({
      source: { revision: "a".repeat(40) }
    });
    expect(catalog.getByDigest("pi-jarvis", artifact.source.digest)).toMatchObject({
      runtimeImage: artifact.runtimeImage
    });
    expect(() => new ProfileArtifactCatalog([artifact, artifact])).toThrow("Duplicate");
  });
});
