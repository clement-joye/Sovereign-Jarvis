import type { StagedRelease } from "./plugin-release.mjs";
export interface CommandResult {
  status: number | null;
  stdout?: string;
  stderr?: string;
}
export type CommandRunner = (
  command: string,
  args: string[],
  options?: { input?: string }
) => CommandResult;
export interface ComposePluginReleaseDeployerOptions {
  artifactTargets: {
    catalog: string;
    runtimeManifest: string;
    modelCatalog?: string;
  };
  commandRunner?: CommandRunner;
  projectRoot?: string;
  projectName?: string;
  envFile?: string;
  composeFile?: string;
  backupDirectory?: string;
  migrationsDirectory?: string;
  databaseService?: string;
  databaseUser?: string;
  databaseName?: string;
}
export interface DeploymentPreflight {
  configuredControlPlaneImage: string;
  currentMigration: number;
  referencedAgentIds: string[];
}
export declare const durableAgentReferencesSql: string;
export declare const schemaPreflightSql: string;
export declare const schemaMigrationSql: string;
export declare function productionCommandRunner(
  command: string,
  args: string[],
  options?: { input?: string }
): CommandResult;
export declare function createComposePluginReleaseDeployer(
  options: ComposePluginReleaseDeployerOptions
): {
  deploy(release: StagedRelease, releaseDirectory: string): Promise<void>;
  preflight(): Promise<DeploymentPreflight>;
};
