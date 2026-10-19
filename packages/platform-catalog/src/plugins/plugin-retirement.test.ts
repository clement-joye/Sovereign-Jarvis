import { describe, expect, it } from "vitest";
import { planPluginRetirement } from "../../../../scripts/plugins/plugin-retirement.mjs";

const manifests = [
  { id: "core", activation: "built-in", agents: [{ id: "brain" }] },
  { id: "old", activation: "workspace", agents: [{ id: "old-agent" }] },
  { id: "new", activation: "workspace", agents: [{ id: "new-agent" }] }
];

describe("plugin retirement planning", () => {
  it("fails closed when durable-reference evidence is omitted", () => {
    const planWithoutEvidence = planPluginRetirement as unknown as (
      pluginId: string,
      installedManifests: typeof manifests
    ) => unknown;
    expect(() => planWithoutEvidence("old", manifests)).toThrow(
      /Explicit durable-reference evidence/
    );
    expect(() =>
      planPluginRetirement({ pluginId: "old", installedManifests: manifests } as never)
    ).toThrow(/Explicit durable-reference evidence/);
  });

  it("plans removal when no durable references remain", () => {
    expect(planPluginRetirement("old", manifests, [], [])).toMatchObject({
      action: "remove",
      pluginId: "old",
      migrated: false
    });
  });
  it("plans explicit migration without claiming records changed", () => {
    expect(
      planPluginRetirement("old", manifests, ["old-agent"], [], { "old-agent": "new-agent" })
    ).toMatchObject({
      action: "migrate",
      migrationSteps: [{ from: "old-agent", to: "new-agent" }],
      migrated: false
    });
  });
  it.each([
    ["built-in", "core", [], []],
    ["unknown", "missing", [], []],
    ["binding", "old", [], ["old"]]
  ])("rejects %s retirement", (_label, id, references, bindings) => {
    expect(() => planPluginRetirement(id, manifests, references, bindings)).toThrow();
  });
  it("rejects incomplete, unknown, and retiring replacement agents", () => {
    expect(() => planPluginRetirement("old", manifests, ["old-agent"], [], {})).toThrow(/cover/);
    expect(() =>
      planPluginRetirement("old", manifests, [], [], { "old-agent": "missing" })
    ).toThrow(/Invalid/);
    expect(() =>
      planPluginRetirement("old", manifests, [], [], { "old-agent": "old-agent" })
    ).toThrow(/retired/);
  });
});
