export const templateId: string;
export const templateVersion: string;
export const imageTag: string;

export interface HostLocalProfileResource {
  path: string;
  kind: "extension" | "skill" | "configuration" | "dependency";
  compatibility: "sdk-compatible";
  rationale: string;
}

export interface HostLocalCurrentRuntimeManifest {
  schemaVersion: 1;
  profileArtifact: {
    schemaVersion: 1;
    id: "pi-jarvis";
    version: "1.0.0";
    source: { repository: string; revision: string; digest: string };
    runtimeImage: string;
    modelsPath: "models.json";
    resources: HostLocalProfileResource[];
  };
  currentRuntime: {
    templateId: string;
    templateVersion: string;
    imageId: string;
    runtimeImageIds?: Record<string, string>;
    resourceBundle?: {
      digest: string;
      artifactName: string;
    };
    network: "restricted";
    modelNetwork: "restricted";
  };
}

export function buildHostLocalReleaseManifest(
  imageId: string,
  runtimeImageIds?: Record<string, string>,
  resourceBundle?: { digest: string; artifactName: string }
): HostLocalCurrentRuntimeManifest;

export function resourceOnlyHostLocalReleaseManifest(
  current: HostLocalCurrentRuntimeManifest,
  resourceBundle: { digest: string; artifactName: string }
): HostLocalCurrentRuntimeManifest;
