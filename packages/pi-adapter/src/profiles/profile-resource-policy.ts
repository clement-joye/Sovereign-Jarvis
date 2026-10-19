import { relative, resolve } from "node:path";

export interface ReviewedProfileResource {
  path: string;
  compatibility: "sdk-compatible" | "interactive-only" | "host-dependent" | "unsuitable";
}

/** Resolves only SDK-compatible, review-listed resources below a profile root. */
export function resolveApprovedProfileResources(
  profileRoot: string,
  resources: readonly ReviewedProfileResource[]
): readonly string[] {
  return resources
    .filter((resource) => resource.compatibility === "sdk-compatible")
    .map((resource) => {
      const target = resolve(profileRoot, resource.path);
      const path = relative(resolve(profileRoot), target);
      if (!path || path.startsWith("..") || path.includes("../")) {
        throw new Error(`Profile resource escapes its root: ${resource.path}`);
      }
      return target;
    });
}
