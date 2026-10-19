import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  generatePluginDocs,
  validateRetiredIdentifierReservations,
  validatePluginSource
} from "../../../../scripts/plugins/plugin-workflow.mjs";

describe("plugin workflow", () => {
  it("validates closure and documents installed plugins deterministically", async () => {
    const root = await mkdtemp(join(tmpdir(), "plugin-workflow-"));
    const pluginRoot = join(root, "plugins/echo");
    const readmePath = join(pluginRoot, "README.md");
    try {
      await mkdir(join(pluginRoot, "resources/echo"), { recursive: true });
      await writeFile(readmePath, "# Echo plugin\n");

      const manifest = {
        id: "echo",
        displayName: "Echo",
        activation: "workspace",
        agents: [{ id: "echo" }],
        localToolProviders: [
          {
            id: "echo-provider",
            capabilityId: "echo",
            factoryId: "echo-tools",
            toolNames: ["echo"]
          }
        ],
        brokerProviders: []
      };
      await expect(
        validatePluginSource(pluginRoot, manifest, [
          { implementationId: "echo-tools", create: () => [] }
        ])
      ).resolves.toBe(true);
      expect(generatePluginDocs([manifest])).toContain(
        "[plugin README](../../plugins/echo/README.md)"
      );
      expect(generatePluginDocs([manifest])).not.toContain("Source digest");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("retired identifier reservations", () => {
  const registry = {
    schemaVersion: 1,
    pluginIds: ["retired-plugin"],
    agentIds: ["retired-agent"],
    capabilityIds: ["retired-capability"]
  };

  it.each([
    ["plugin", { id: "retired-plugin", agents: [], localToolProviders: [], brokerProviders: [] }],
    [
      "agent",
      {
        id: "current-plugin",
        agents: [{ id: "retired-agent" }],
        localToolProviders: [],
        brokerProviders: []
      }
    ],
    [
      "capability",
      {
        id: "current-plugin",
        agents: [],
        localToolProviders: [{ capabilityId: "retired-capability" }],
        brokerProviders: []
      }
    ]
  ])("rejects reserved retired %s identifiers", (_kind, manifest) => {
    expect(() => validateRetiredIdentifierReservations(manifest, registry)).toThrow(
      /cannot be reused/
    );
  });

  it("rejects malformed registry input instead of silently ignoring it", () => {
    expect(() =>
      validateRetiredIdentifierReservations(
        { id: "current-plugin", agents: [], localToolProviders: [], brokerProviders: [] },
        { schemaVersion: 1, pluginIds: [], agentIds: [], capabilityIds: ["ordered", "not"] }
      )
    ).toThrow(/Invalid retired identifier registry capabilityIds/);
  });
});
