import { describe, expect, it } from "vitest";
import { validateReviewedRuntimeSpecification } from "./runtime-provisioner-policy.js";

describe("runtime provisioner policy", () => {
  it("accepts reviewed immutable runtime specifications", () => {
    expect(
      validateReviewedRuntimeSpecification({
        templateId: "code-project",
        templateVersion: "1.0.0",
        image: `jarvis/code-runtime@sha256:${"a".repeat(64)}`,
        network: "restricted",
        writableVolumeName: "workspace-code-1"
      })
    ).toMatchObject({ templateId: "code-project", modelNetwork: "none" });
  });
  it("rejects unsafe runtime identifiers", () => {
    expect(() =>
      validateReviewedRuntimeSpecification({
        templateId: "../code",
        templateVersion: "1.0.0",
        image: "jarvis/runtime",
        network: "none",
        writableVolumeName: "workspace"
      })
    ).toThrow("template id");
    expect(() =>
      validateReviewedRuntimeSpecification({
        templateId: "code",
        templateVersion: "1.0.0",
        image: "/var/run/docker.sock",
        network: "none",
        writableVolumeName: "workspace"
      })
    ).toThrow("image");
  });

  it("validates dedicated runtime-class image overrides", () => {
    expect(() =>
      validateReviewedRuntimeSpecification({
        templateId: "code-project",
        templateVersion: "1.0.0",
        image: `sha256:${"a".repeat(64)}`,
        runtimeImages: { browser: "jarvis/pi-jarvis:browser" },
        network: "restricted",
        writableVolumeName: "workspace"
      })
    ).toThrow("runtime class image");
  });

  it("accepts a digest-pinned release-relative resource bundle", () => {
    expect(
      validateReviewedRuntimeSpecification({
        templateId: "code-project",
        templateVersion: "1.0.0",
        image: `sha256:${"a".repeat(64)}`,
        resourceBundle: {
          digest: `sha256:${"b".repeat(64)}`,
          artifactName: "role-resources"
        },
        network: "restricted",
        writableVolumeName: "workspace"
      })
    ).toMatchObject({ resourceBundle: { artifactName: "role-resources" } });
  });

  it("rejects host paths and mutable resource bundle identities", () => {
    const specification = {
      templateId: "code-project",
      templateVersion: "1.0.0",
      image: `sha256:${"a".repeat(64)}`,
      network: "restricted" as const,
      writableVolumeName: "workspace"
    };
    expect(() =>
      validateReviewedRuntimeSpecification({
        ...specification,
        resourceBundle: { digest: "latest", artifactName: "role-resources" }
      })
    ).toThrow("resource bundle digest");
    expect(() =>
      validateReviewedRuntimeSpecification({
        ...specification,
        resourceBundle: {
          digest: `sha256:${"b".repeat(64)}`,
          artifactName: "../roles"
        }
      })
    ).toThrow("artifact name");
  });
});
