export interface ReleaseArtifact {
  path: string;
  sha256: string;
}
export interface DatabaseCompatibility {
  minimumMigration: number;
  maximumMigration: number;
}
export interface RuntimeImageIds {
  base: string;
  isolated: string;
  browser: string;
}
export interface StagedRelease {
  schemaVersion: 1;
  pluginApiSchemaRevision: 1;
  gitRevision: string;
  databaseCompatibility: DatabaseCompatibility;
  catalogDigest: string;
  modelCatalogDigest: string;
  artifacts: Record<"catalog" | "runtimeManifest" | "modelCatalog", ReleaseArtifact>;
  imageIds: { controlPlane: string; runtimeClasses: RuntimeImageIds };
  id: string;
}
export interface ReleaseInput {
  catalogPath: string;
  runtimeManifestPath: string;
  modelCatalogPath: string;
  controlPlaneImageId: string;
  gitRevision: string;
  databaseCompatibility: DatabaseCompatibility;
  releaseRoot: string;
}
export interface DeployOptions {
  stateRoot: string;
  /** Required by recovery; must match the recorded previous deployment. */
  gitRevision?: string;
  deploy: (release: StagedRelease, directory: string) => Promise<void>;
  referencedAgentIds: string[];
  currentMigration: number;
}
export declare function stageRelease(
  input: ReleaseInput
): Promise<StagedRelease & { directory: string }>;
export declare function verifyRelease(
  directory: string,
  options?: Pick<DeployOptions, "referencedAgentIds" | "currentMigration">
): Promise<StagedRelease>;
export declare function activateRelease(
  directory: string,
  options: DeployOptions
): Promise<StagedRelease>;
export declare function rollbackRelease(options: DeployOptions): Promise<StagedRelease>;
export declare function deployRelease(
  input: ReleaseInput,
  options: DeployOptions
): Promise<StagedRelease>;
export declare const recoverPreviousDeployment: typeof rollbackRelease;
