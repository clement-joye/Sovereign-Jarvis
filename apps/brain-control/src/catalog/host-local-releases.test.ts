import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadHostLocalWorkspaceTemplateCatalog } from "./host-local-releases.js";

describe("host-local workspace releases", () => {
  it("makes only the reviewed code-project release selectable", () => {
    const path = join(mkdtempSync(join(tmpdir(), "jarvis-release-")), "releases.json");
    writeFileSync(path, JSON.stringify(manifest()));

    expect(
      loadHostLocalWorkspaceTemplateCatalog({ RUNTIME_CURRENT_PROFILE_PATH: path }).get(
        "code-project"
      )
    ).toMatchObject({
      version: "1.0.0",
      profileArtifact: { id: "pi-jarvis", digest: `sha256:${"c".repeat(64)}` },
      capabilities: { filesystem: "workspace-write", network: "restricted", subagents: false }
    });
  });

  it("filters non-SDK-compatible extensions and skills out of the template", () => {
    const path = join(mkdtempSync(join(tmpdir(), "jarvis-release-")), "releases.json");
    writeFileSync(path, JSON.stringify(manifest({ includeAllKinds: true })));

    const template = loadHostLocalWorkspaceTemplateCatalog({
      RUNTIME_CURRENT_PROFILE_PATH: path
    }).get("code-project");

    expect(template?.extensions).toEqual(["extensions/sdk-only"]);
    expect(template?.skills).toEqual(["skills", "skills-rev"]);
  });

  it("ignores releases whose templateId is not code-project", () => {
    const path = join(mkdtempSync(join(tmpdir(), "jarvis-release-")), "releases.json");
    writeFileSync(path, JSON.stringify(manifest({ templateId: "second-brain" })));

    const catalog = loadHostLocalWorkspaceTemplateCatalog({
      RUNTIME_CURRENT_PROFILE_PATH: path
    });

    expect(catalog.get("code-project")).toBeUndefined();
    expect(catalog.get("second-brain")).toBeDefined();
  });
});

function manifest(options: { includeAllKinds?: boolean; templateId?: string } = {}) {
  const includeAllKinds = options.includeAllKinds ?? false;
  const templateId = options.templateId ?? "code-project";
  type ResourceShape = {
    path: string;
    kind: "skill" | "extension" | "configuration" | "dependency";
    compatibility: "sdk-compatible" | "interactive-only" | "host-dependent" | "unsuitable";
    rationale: string;
  };
  const resources: ResourceShape[] = [
    {
      path: "skills",
      kind: "skill" as const,
      compatibility: "sdk-compatible" as const,
      rationale: "Reviewed skills."
    },
    {
      path: "skills-rev",
      kind: "skill" as const,
      compatibility: "sdk-compatible" as const,
      rationale: "Reviewed skills."
    },
    {
      path: "extensions/sdk-only",
      kind: "extension" as const,
      compatibility: "sdk-compatible" as const,
      rationale: "Loads through the SDK without interactive prompts."
    }
  ];
  if (includeAllKinds) {
    resources.push(
      {
        path: "extensions/unsuitable",
        kind: "extension" as const,
        compatibility: "unsuitable" as const,
        rationale: "Requires interactive TUI confirmation."
      },
      {
        path: "extensions/host",
        kind: "extension" as const,
        compatibility: "host-dependent" as const,
        rationale: "Reads the host Pi settings directory."
      },
      {
        path: "extensions/interactive",
        kind: "extension" as const,
        compatibility: "interactive-only" as const,
        rationale: "Renders a terminal widget."
      },
      {
        path: "skills/unsuitable",
        kind: "skill" as const,
        compatibility: "unsuitable" as const,
        rationale: "Targets an unsuitable extension."
      }
    );
  }
  return {
    schemaVersion: 1,
    profileArtifact: {
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
      resources
    },
    currentRuntime: {
      templateId,
      templateVersion: "1.0.0",
      imageId: `sha256:${"a".repeat(64)}`,
      network: "restricted"
    }
  };
}
