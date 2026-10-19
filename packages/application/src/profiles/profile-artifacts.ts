import {
  ProfileArtifactManifestV1Schema,
  type ProfileArtifactManifestV1
} from "@second-brain/contracts";

/** Immutable registry of reviewed profile releases available to templates. */
export class ProfileArtifactCatalog {
  private readonly artifacts = new Map<string, ProfileArtifactManifestV1>();

  constructor(artifacts: readonly ProfileArtifactManifestV1[]) {
    for (const artifact of artifacts) {
      const parsed = ProfileArtifactManifestV1Schema.parse(artifact);
      const key = `${parsed.id}@${parsed.version}`;
      if (this.artifacts.has(key)) throw new Error(`Duplicate profile artifact: ${key}`);
      this.artifacts.set(key, Object.freeze(parsed));
    }
  }

  get(id: string, version: string): ProfileArtifactManifestV1 | undefined {
    return this.artifacts.get(`${id}@${version}`);
  }

  getByDigest(id: string, digest: string): ProfileArtifactManifestV1 | undefined {
    return [...this.artifacts.values()].find(
      (artifact) => artifact.id === id && artifact.source.digest === digest
    );
  }
}
