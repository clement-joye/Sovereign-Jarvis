import { readFileSync } from "node:fs";

import {
  HostLocalRuntimeProfileManifestV1Schema,
  type ProfileArtifactManifestV1
} from "@second-brain/contracts";
import {
  BUILT_IN_WORKSPACE_TEMPLATES,
  ProfileArtifactCatalog,
  WorkspaceTemplateCatalog,
  type WorkspaceTemplateDefinition
} from "@second-brain/application";

export function loadHostLocalWorkspaceTemplateCatalog(
  env: NodeJS.ProcessEnv = process.env
): WorkspaceTemplateCatalog {
  const manifestPath = env.RUNTIME_CURRENT_PROFILE_PATH;
  if (!manifestPath) return new WorkspaceTemplateCatalog();
  const manifest = HostLocalRuntimeProfileManifestV1Schema.parse(
    JSON.parse(readFileSync(manifestPath, "utf8"))
  );
  const runtime = manifest.currentRuntime;
  if (runtime.templateId !== "code-project") return new WorkspaceTemplateCatalog();
  const profiles = new ProfileArtifactCatalog([manifest.profileArtifact]);
  if (!profiles.getByDigest("pi-jarvis", manifest.profileArtifact.source.digest)) {
    throw new Error("Missing reviewed pi-jarvis artifact.");
  }
  return new WorkspaceTemplateCatalog([
    ...BUILT_IN_WORKSPACE_TEMPLATES,
    codeProjectTemplate(manifest.profileArtifact, runtime.templateVersion)
  ]);
}

function codeProjectTemplate(
  artifact: ProfileArtifactManifestV1,
  version: string
): WorkspaceTemplateDefinition {
  return {
    schemaVersion: 1,
    id: "code-project",
    version,
    displayName: "Code project",
    description: "An isolated project workspace using the reviewed local Pi profile.",
    runtimeClass: "code-project",
    profileArtifact: {
      id: artifact.id,
      digest: artifact.source.digest,
      modelsPath: artifact.modelsPath
    },
    // The profile artifact classifies every resource; the template only
    // activates SDK-compatible skills and extensions. Anything tagged
    // interactive-only, host-dependent, or unsuitable stays in the runtime
    // image (the Dockerfile copies the same accepted-resources allowlist)
    // but is intentionally absent from the workspace activation surface.
    skills: artifact.resources
      .filter(
        (resource) => resource.kind === "skill" && resource.compatibility === "sdk-compatible"
      )
      .map((resource) => resource.path),
    extensions: artifact.resources
      .filter(
        (resource) => resource.kind === "extension" && resource.compatibility === "sdk-compatible"
      )
      .map((resource) => resource.path),
    tools: ["workspace-read", "workspace-write", "workspace-edit", "workspace-grep"],
    capabilities: { filesystem: "workspace-write", network: "restricted", subagents: false },
    onboarding: [{ id: "project-name", label: "Project name", type: "text", required: true }]
  };
}
