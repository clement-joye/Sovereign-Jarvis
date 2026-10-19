import { describe, expect, it } from "vitest";
import { RuntimeTemplateCatalog } from "./runtime-template-catalog.js";
const entry = {
  templateId: "code-project",
  templateVersion: "1.0.0",
  specification: {
    templateId: "code-project",
    templateVersion: "1.0.0",
    image: `jarvis/code@sha256:${"a".repeat(64)}`,
    network: "restricted" as const,
    writableVolumeName: "workspace-code"
  }
};
describe("RuntimeTemplateCatalog", () => {
  it("selects only reviewed template versions", () => {
    const catalog = new RuntimeTemplateCatalog([entry]);
    expect(catalog.get("code-project", "1.0.0")).toMatchObject({
      specification: { network: "restricted" }
    });
    expect(catalog.get("code-project", "2.0.0")).toBeUndefined();
  });
  it("rejects duplicate and invalid entries", () => {
    expect(() => new RuntimeTemplateCatalog([entry, entry])).toThrow("Duplicate");
    expect(
      () =>
        new RuntimeTemplateCatalog([
          { ...entry, specification: { ...entry.specification, image: "jarvis/code:latest" } }
        ])
    ).toThrow("image");
  });
});
