import type { StructuredErrorV1 } from "@second-brain/contracts";

export function structuredError(
  input: Omit<StructuredErrorV1, "schemaVersion">
): StructuredErrorV1 {
  return { schemaVersion: 1, ...input };
}
