export interface BundlePluginResourcesInput {
  pluginRoot: string;
  outputRoot: string;
  claimedPaths?: Set<string>;
}

export interface BundlePluginDirectoryInput {
  manifestRoot: string;
  outputRoot: string;
}

export function bundlePluginResources(input: BundlePluginResourcesInput): Promise<string[]>;
export function bundlePluginDirectory(input: BundlePluginDirectoryInput): Promise<string[]>;
export function updateAcceptedResources(path: string, pluginTargets: string[]): Promise<void>;
export function resourceFiles(root: string): Promise<string[]>;
export function safeRelativePath(value: string, label: string): string;
