export interface ReviewedRuntimeSpecification {
  templateId: string;
  templateVersion: string;
  image: string;
  /** Optional immutable image overrides for runtime classes with dedicated dependencies. */
  runtimeImages?: Partial<Record<string, string>>;
  /** Optional reviewed read-only resource bundle selected by digest and release-relative name. */
  resourceBundle?: ReviewedResourceBundle;
  network: "none" | "restricted";
  /** A separately isolated network used only to reach the reviewed local model service. */
  modelNetwork?: "none" | "restricted";
  writableVolumeName: string;
}

export interface ReviewedResourceBundle {
  digest: string;
  artifactName: string;
}

/** Validates the narrow input accepted by a privileged runtime provisioner. */
export function validateReviewedRuntimeSpecification(
  specification: ReviewedRuntimeSpecification
): ReviewedRuntimeSpecification {
  if (!/^[a-z][a-z0-9-]*$/.test(specification.templateId))
    throw new Error("Invalid runtime template id");
  if (!/^\d+\.\d+\.\d+/.test(specification.templateVersion))
    throw new Error("Invalid runtime template version");
  if (!/^[a-z0-9][a-z0-9_.-]*$/.test(specification.writableVolumeName))
    throw new Error("Invalid runtime volume name");
  if (
    !/^(?:[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}|sha256:[a-f0-9]{64})$/.test(specification.image)
  )
    throw new Error("Invalid runtime image");
  for (const image of Object.values(specification.runtimeImages ?? {}).filter(
    (image): image is string => typeof image === "string"
  )) {
    if (!/^(?:[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}|sha256:[a-f0-9]{64})$/.test(image)) {
      throw new Error("Invalid runtime class image");
    }
  }
  if (specification.resourceBundle) validateReviewedResourceBundle(specification.resourceBundle);
  return Object.freeze({ ...specification, modelNetwork: specification.modelNetwork ?? "none" });
}

function validateReviewedResourceBundle(bundle: ReviewedResourceBundle): void {
  if (!/^sha256:[a-f0-9]{64}$/.test(bundle.digest)) {
    throw new Error("Invalid resource bundle digest");
  }
  if (
    !bundle.artifactName ||
    bundle.artifactName.startsWith("/") ||
    bundle.artifactName.includes("\\") ||
    bundle.artifactName
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Invalid resource bundle artifact name");
  }
}
