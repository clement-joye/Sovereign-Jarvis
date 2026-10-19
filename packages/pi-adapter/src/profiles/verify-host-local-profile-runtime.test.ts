import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { expectedRuntimeExtensions } from "../../../../scripts/runtime/verify-host-local-profile-runtime.mjs";

const acceptedResources = readFileSync(
  new URL("../../../../deploy/pi-runtime/accepted-resources.txt", import.meta.url),
  "utf8"
);
const browserExtension = "/opt/profile/extensions/browser/index.ts";
const coreExtension = "/opt/profile/extensions/extra-tools/index.ts";

describe("host-local runtime verifier inventory", () => {
  it.each(["base", "isolated"] as const)(
    "excludes the Browser-only extension from the %s runtime",
    (runtimeClass) => {
      expect(expectedRuntimeExtensions(acceptedResources, runtimeClass)).not.toContain(
        browserExtension
      );
      expect(expectedRuntimeExtensions(acceptedResources, runtimeClass)).toEqual([coreExtension]);
    }
  );

  it("includes the Browser extension in the derived Browser runtime", () => {
    expect(expectedRuntimeExtensions(acceptedResources, "browser")).toEqual([browserExtension]);
  });

  it("fails closed for an unknown runtime class", () => {
    expect(() => expectedRuntimeExtensions(acceptedResources, "unknown" as "browser")).toThrow(
      "Unsupported host-local runtime class"
    );
  });
});
