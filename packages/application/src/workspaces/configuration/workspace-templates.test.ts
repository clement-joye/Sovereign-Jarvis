import { describe, expect, it } from "vitest";
import { ProfileArtifactCatalog } from "../../profiles/profile-artifacts.js";
import { WorkspaceTemplateCatalog } from "./workspace-templates.js";
describe("WorkspaceTemplateCatalog", () => {
  it("exposes only reviewed built-in templates", () => {
    const catalog = new WorkspaceTemplateCatalog();
    expect(catalog.get("second-brain")).toMatchObject({
      version: "1.0.0",
      runtimeClass: "second-brain",
      onboarding: [{ id: "timezone", required: true }]
    });
    expect(catalog.get("code-project")).toBeUndefined();
  });

  it("rejects duplicate identifiers and malformed trusted manifests at startup", () => {
    const template = new WorkspaceTemplateCatalog().get("second-brain")!;
    expect(() => new WorkspaceTemplateCatalog([template, template])).toThrow(
      "Duplicate workspace template id"
    );
    expect(
      () => new WorkspaceTemplateCatalog([{ ...template, systemPromptPath: "../untrusted.md" }])
    ).toThrow(/relative paths/);
  });

  it("requires every template profile digest to resolve from the reviewed catalog", () => {
    const template = new WorkspaceTemplateCatalog().get("second-brain")!;
    const profiles = new ProfileArtifactCatalog([
      {
        schemaVersion: 1,
        id: "second-brain-profile",
        version: "1.0.0",
        source: {
          repository: "https://github.com/clement-joye/Jarvis",
          revision: "a".repeat(40),
          digest: template.profileArtifact.digest
        },
        runtimeImage: `jarvis/second-brain@sha256:${"b".repeat(64)}`,
        modelsPath: "models.json",
        resources: [
          {
            path: "models.json",
            kind: "configuration",
            compatibility: "sdk-compatible",
            rationale: "Static reviewed model configuration."
          }
        ]
      }
    ]);
    expect(() => new WorkspaceTemplateCatalog([template], profiles)).not.toThrow();
    expect(
      () =>
        new WorkspaceTemplateCatalog(
          [
            {
              ...template,
              profileArtifact: { ...template.profileArtifact, digest: `sha256:${"c".repeat(64)}` }
            }
          ],
          profiles
        )
    ).toThrow("Unreviewed profile artifact");
  });
});
