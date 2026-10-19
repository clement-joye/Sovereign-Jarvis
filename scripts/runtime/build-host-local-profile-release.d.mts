import type { HostLocalCurrentRuntimeManifest } from "./host-local-profile-release.mjs";

export function resourceOnlyHostLocalReleaseManifest(
  current: HostLocalCurrentRuntimeManifest,
  resourceBundle: { digest: string; artifactName: string }
): HostLocalCurrentRuntimeManifest;

export function writeCurrentHostLocalRuntimeManifest(
  outputPath: string,
  manifest: HostLocalCurrentRuntimeManifest
): Promise<void>;
