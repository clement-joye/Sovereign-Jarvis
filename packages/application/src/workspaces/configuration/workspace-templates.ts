import {
  WorkspaceTemplateManifestV1Schema,
  type WorkspaceTemplateManifestV1
} from "@second-brain/contracts";
import type { ProfileArtifactCatalog } from "../../profiles/profile-artifacts.js";

export type WorkspaceTemplateDefinition = WorkspaceTemplateManifestV1;

/** Trusted, reviewed templates available to the deterministic onboarding flow. */
export const BUILT_IN_WORKSPACE_TEMPLATES: readonly WorkspaceTemplateDefinition[] = [
  {
    schemaVersion: 1,
    id: "second-brain",
    version: "1.0.0",
    displayName: "Second brain",
    description: "A private workspace for notes, conversations, and scheduled assistance.",
    runtimeClass: "second-brain",
    systemPromptPath: "prompts/second-brain.md",
    profileArtifact: {
      id: "second-brain-profile",
      digest: `sha256:${"0".repeat(64)}`,
      modelsPath: "models.json"
    },
    skills: [],
    extensions: [],
    tools: ["workspace-read"],
    capabilities: { filesystem: "read-only", network: "none", subagents: false },
    onboarding: [
      {
        id: "timezone",
        label: "Workspace timezone",
        description: "IANA timezone used for workspace-level scheduling defaults.",
        type: "text",
        required: true
      }
    ]
  }
];

export class WorkspaceTemplateCatalog {
  constructor(
    private readonly templates: readonly WorkspaceTemplateDefinition[] = BUILT_IN_WORKSPACE_TEMPLATES,
    profiles?: Pick<ProfileArtifactCatalog, "getByDigest">
  ) {
    const ids = new Set<string>();
    for (const template of templates) {
      WorkspaceTemplateManifestV1Schema.parse(template);
      if (ids.has(template.id)) {
        throw new Error(`Duplicate workspace template id: ${template.id}`);
      }
      if (
        profiles &&
        !profiles.getByDigest(template.profileArtifact.id, template.profileArtifact.digest)
      ) {
        throw new Error(
          `Unreviewed profile artifact for template ${template.id}@${template.version}: ${template.profileArtifact.id}@${template.profileArtifact.digest}`
        );
      }
      ids.add(template.id);
    }
  }

  get(id: string): WorkspaceTemplateDefinition | undefined {
    return this.templates.find((template) => template.id === id);
  }

  list(): readonly WorkspaceTemplateDefinition[] {
    return this.templates;
  }
}
