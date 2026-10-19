export interface HostLocalRuntimeProfileUpdateOptions {
  help?: boolean;
  envFile?: string;
  composeFile?: string;
  runtimeProfileDir?: string;
  platformCatalogDir?: string;
  /** Publish prompts and skills while preserving every executable image ID. */
  resourcesOnly?: boolean;
  /** True by default; pass --new-rooms-only to leave existing rooms unchanged. */
  replaceRoomRuntimes?: boolean;
}

export const runtimeProfileWorkerServiceNames: readonly ["brain-worker", "brain-delegation-worker"];

export const runtimeProfileServiceNames: readonly [
  "brain-control",
  "matrix-gateway",
  "runtime-provisioner",
  "brain-worker",
  "brain-delegation-worker"
];

export function pluginIntegrityPreflightArgs(projectRoot: string): string[];

export function incrementalTypecheckArgs(projectRoot: string): string[];

export function runtimeImageVerificationArgs(
  projectRoot: string,
  runtimeClass: string,
  imageId: string
): string[];

export function hostLocalProfileReleaseBuildArgs(
  projectRoot: string,
  manifestPath: string,
  resourcesOnly: boolean
): string[];

export function parseOptions(args: readonly string[]): HostLocalRuntimeProfileUpdateOptions;
