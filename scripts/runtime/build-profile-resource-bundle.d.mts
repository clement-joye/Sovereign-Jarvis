export interface ProfileResourceBundleInput {
  profileRoot: string;
  pluginsRoot: string;
  outputRoot: string;
  acceptedResourcesPath?: string;
  classificationPath?: string;
}

export interface ProfileResourceBundleResult {
  artifactName: string;
  digest: string;
  files: string[];
  outputRoot: string;
  reused: boolean;
}

export function buildProfileResourceBundle(
  input: ProfileResourceBundleInput
): Promise<ProfileResourceBundleResult>;

export function profileResourceDigest(files: ReadonlyMap<string, string | Uint8Array>): string;
