import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  compilePlatformCatalogV2,
  parsePlatformCatalogV2Artifact,
  platformCatalogDigestV2,
  readPlatformCatalogV2Artifact
} from "../index.js";

function catalog() {
  return compilePlatformCatalogV2({
    plugins: [
      {
        manifest: {
          schemaVersion: 2,
          id: "core",
          displayName: "Core",
          activation: "built-in",
          agents: [
            {
              id: "assistant",
              defaultForWorkspace: true,
              runtimeClass: "restricted",
              promptPath: "assistant/AGENTS.md",
              skillPaths: [],
              extensionPaths: [],
              capabilityIds: [],
              runtimeFeatureIds: [],
              workspaceAccess: "read",
              threadContextPolicy: "fresh_session_with_thread_history",
              model: { providerId: "local", modelId: "small" },
              timeoutSeconds: 300,
              tokenBudget: 50_000,
              maxConcurrentRunsPerWorkspace: 1
            }
          ],
          localToolProviders: [],
          brokerProviders: [],
          runtimeFeatures: []
        },
        files: new Map([["assistant/AGENTS.md", "Reviewed prompt"]])
      }
    ],
    runtimeClasses: [
      {
        id: "restricted",
        image: `jarvis/runtime@sha256:${"a".repeat(64)}`,
        mountPolicy: "read-only",
        networkPolicy: "restricted",
        featureIds: [],
        resourceCeiling: {
          timeoutSeconds: 600,
          tokenBudget: 100_000,
          maxConcurrentRuns: 2,
          memoryMiB: 4096,
          cpuMillicores: 4000,
          pids: 128,
          maxOutputBytes: 1_000_000
        }
      }
    ],
    reviewedModels: [{ providerId: "local", modelId: "small" }],
    localToolFactoryIds: [],
    brokerProviderIds: []
  });
}

describe("platform catalog artifact loader", () => {
  it("loads a file and provides immutable lookups", async () => {
    const directory = await mkdtemp(join(tmpdir(), "platform-catalog-"));
    const path = join(directory, "catalog.json");
    try {
      await writeFile(path, JSON.stringify(catalog()));
      const reader = await readPlatformCatalogV2Artifact(path);
      expect(reader.getAgent("assistant")?.id).toBe("assistant");
      expect(reader.getAgent("missing")).toBeUndefined();
      expect(reader.getRuntimeClass("restricted")?.id).toBe("restricted");
      expect(reader.getRuntimeClass("missing")).toBeUndefined();
      expect(reader.getRuntimeFeature("missing")).toBeUndefined();
      expect(reader.getCapability("missing")).toBeUndefined();
      expect(reader.getPlugin("core")?.id).toBe("core");
      expect(reader.getPlugin("missing")).toBeUndefined();
      expect(Object.isFrozen(reader.catalog)).toBe(true);
      expect(Object.isFrozen(reader.catalog.agents[0])).toBe(true);
      expect(() => {
        (reader.catalog.agents as unknown as Array<unknown>).push({});
      }).toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects malformed JSON and tampered content or digest", () => {
    expect(() => parsePlatformCatalogV2Artifact("{bad json")).toThrow(
      "Invalid platform catalog JSON"
    );
    const value = catalog();
    expect(() =>
      parsePlatformCatalogV2Artifact(
        JSON.stringify({ ...value, digest: `sha256:${"b".repeat(64)}` })
      )
    ).toThrow("digest mismatch");
    expect(() =>
      parsePlatformCatalogV2Artifact(JSON.stringify({ ...value, agents: [] }))
    ).toThrow();
    expect(() =>
      parsePlatformCatalogV2Artifact(
        JSON.stringify({
          ...value,
          agents: [value.agents[0], value.agents[0]]
        })
      )
    ).toThrow("Duplicate agent id");
    expect(() =>
      parsePlatformCatalogV2Artifact(
        JSON.stringify({
          ...value,
          agents: [{ ...value.agents[0], runtimeClass: "missing" }]
        })
      )
    ).toThrow("Unknown agent runtime class");
  });

  it("emits a bounded event for a catalog digest mismatch", () => {
    const events: Array<{ type: string; reason: string; catalogDigest?: string }> = [];
    const value = catalog();
    expect(() =>
      parsePlatformCatalogV2Artifact(
        JSON.stringify({ ...value, digest: `sha256:${"b".repeat(64)}` }),
        { securityEvents: { emit: (event) => events.push(event) } }
      )
    ).toThrow("digest mismatch");
    expect(events).toEqual([
      expect.objectContaining({ type: "catalog.mismatch", reason: "digest_mismatch" })
    ]);
  });

  it("rejects a recomputed catalog whose policy projection was altered", () => {
    const value = catalog();
    const { digest: _digest, ...content } = value;
    const tamperedContent = {
      ...content,
      policyDigest: `sha256:${"b".repeat(64)}`
    };
    const tampered = {
      ...tamperedContent,
      digest: platformCatalogDigestV2(tamperedContent)
    };

    expect(() => parsePlatformCatalogV2Artifact(JSON.stringify(tampered))).toThrow(
      "policy projection"
    );
  });
});
