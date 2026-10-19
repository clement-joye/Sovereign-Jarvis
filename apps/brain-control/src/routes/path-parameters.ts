import { OpaqueId } from "@second-brain/contracts";

/**
 * Decodes a single opaque path segment while preventing malformed escaping,
 * empty values, and slash-containing identifiers from reaching application
 * services.
 */
export function parseOpaquePathParameter(encodedValue: string | undefined): string | undefined {
  if (!encodedValue || encodedValue.includes("/")) {
    return undefined;
  }

  try {
    const value = decodeURIComponent(encodedValue);
    return value.includes("/") || !OpaqueId.safeParse(value).success ? undefined : value;
  } catch {
    return undefined;
  }
}
