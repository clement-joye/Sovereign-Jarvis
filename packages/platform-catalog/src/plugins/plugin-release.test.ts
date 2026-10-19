import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  activateRelease,
  deployRelease,
  recoverPreviousDeployment,
  rollbackRelease,
  stageRelease,
  verifyRelease
} from "../../../../scripts/plugins/plugin-release.mjs";
import type { StagedRelease } from "../../../../scripts/plugins/plugin-release.mjs";

type JsonObject = { [key: string]: JsonValue };
type JsonValue = boolean | null | number | string | JsonObject | JsonValue[];

const sha = (v: string) => `sha256:${createHash("sha256").update(v).digest("hex")}`;
const stable = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(stable).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.entries(v as JsonObject)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`)
          .join(",")}}`
      : (JSON.stringify(v) ?? "undefined");
const image = (c: string) => `sha256:${c.repeat(64)}`;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "jarvis-release-"));
  const content = {
    schemaVersion: 2,
    agents: [
      {
        id: "durable-agent",
        durable: true,
        model: { providerId: "test-provider", modelId: "test-model" }
      }
    ],
    plugins: [{ id: "calendar" }],
    runtimeClasses: [
      { id: "base", image: image("a") },
      { id: "isolated", image: image("a") },
      { id: "browser", image: image("b") }
    ]
  };
  const values = {
    catalog: { ...content, digest: sha(stable(content)) },
    runtimeManifest: {
      currentRuntime: {
        imageId: image("a"),
        runtimeImageIds: { browser: image("b") }
      }
    },
    modelCatalog: {
      providers: { "test-provider": { models: [{ id: "test-model" }] } }
    }
  };
  const paths = {} as Record<keyof typeof values, string>;
  for (const n of Object.keys(values) as Array<keyof typeof values>) {
    const path = join(root, `${n}.json`);
    paths[n] = path;
    await writeFile(path, JSON.stringify(values[n]));
  }
  const input = (c: string) => ({
    catalogPath: paths.catalog,
    runtimeManifestPath: paths.runtimeManifest,
    modelCatalogPath: paths.modelCatalog,
    controlPlaneImageId: image(c),
    gitRevision: c.repeat(40),
    databaseCompatibility: { minimumMigration: 1, maximumMigration: 3 },
    releaseRoot: join(root, "releases")
  });
  return { root, input };
}
describe("plugin release state", () => {
  it("stages, verifies, activates two releases, and rolls back", async () => {
    const { root, input } = await fixture();
    const first = await stageRelease(input("c"));
    await expect(
      verifyRelease(first.directory, { referencedAgentIds: ["durable-agent"], currentMigration: 2 })
    ).resolves.toMatchObject({ id: first.id });
    const deployed: string[] = [];
    const options = {
      stateRoot: join(root, "state"),
      referencedAgentIds: ["durable-agent"],
      currentMigration: 2,
      deploy: async (r: StagedRelease) => {
        deployed.push(r.id);
      }
    };
    await activateRelease(first.directory, options);
    const second = await stageRelease(input("d"));
    await activateRelease(second.directory, options);
    await expect(
      rollbackRelease({ ...options, gitRevision: first.gitRevision })
    ).resolves.toMatchObject({ id: first.id });
    expect(deployed).toEqual([first.id, second.id, first.id]);
    expect(JSON.parse(await readFile(join(root, "state/current.json"), "utf8"))).toMatchObject({
      releaseId: first.id,
      gitRevision: first.gitRevision,
      catalogDigest: first.catalogDigest,
      imageIds: first.imageIds
    });
  });
  it("deploys a reviewed checkout in one owner-facing operation and recovers it", async () => {
    const { root, input } = await fixture();
    const deployed: string[] = [];
    const options = {
      stateRoot: join(root, "state"),
      referencedAgentIds: ["durable-agent"],
      currentMigration: 2,
      deploy: async (release: StagedRelease) => {
        deployed.push(release.id);
      }
    };
    const first = await deployRelease(input("4"), options);
    const second = await deployRelease(input("5"), options);
    await expect(
      recoverPreviousDeployment({ ...options, gitRevision: first.gitRevision })
    ).resolves.toMatchObject({ id: first.id });
    expect(deployed).toEqual([first.id, second.id, first.id]);
  });
  it("refuses recovery from a checkout other than the recorded previous revision", async () => {
    const { root, input } = await fixture();
    const options = {
      stateRoot: join(root, "state"),
      referencedAgentIds: ["durable-agent"],
      currentMigration: 2,
      deploy: async () => {}
    };
    await deployRelease(input("6"), options);
    await deployRelease(input("7"), options);
    await expect(
      recoverPreviousDeployment({ ...options, gitRevision: "8".repeat(40) })
    ).rejects.toThrow(/does not match previous deployment/);
  });
  it("leaves current pointer unchanged when deployment fails", async () => {
    const { root, input } = await fixture();
    const first = await stageRelease(input("e"));
    const stateRoot = join(root, "state");
    const preflight = { referencedAgentIds: ["durable-agent"], currentMigration: 2 };
    await activateRelease(first.directory, { stateRoot, ...preflight, deploy: async () => {} });
    const before = await readFile(join(stateRoot, "current.json"), "utf8");
    const second = await stageRelease(input("f"));
    await expect(
      activateRelease(second.directory, {
        stateRoot,
        ...preflight,
        deploy: async () => {
          throw new Error("deploy failed");
        }
      })
    ).rejects.toThrow("deploy failed");
    expect(await readFile(join(stateRoot, "current.json"), "utf8")).toBe(before);
  });
  it("rejects tampered artifacts and missing agents", async () => {
    const { input } = await fixture();
    const release = await stageRelease(input("1"));
    await writeFile(join(release.directory, "platform-catalog.v2.json"), "tampered");
    await expect(verifyRelease(release.directory)).rejects.toThrow(/digest mismatch/);
    const f = await fixture();
    const valid = await stageRelease(f.input("2"));
    await expect(
      verifyRelease(valid.directory, { referencedAgentIds: ["missing-agent"], currentMigration: 2 })
    ).rejects.toThrow(/referenced agent/);
  });

  it("rejects a release model catalog that cannot serve a reviewed agent", async () => {
    const { input } = await fixture();
    const releaseInput = input("3");
    await writeFile(releaseInput.modelCatalogPath, JSON.stringify({ providers: {} }));
    await expect(stageRelease(releaseInput)).rejects.toThrow(/lacks test-provider\/test-model/);
  });
});
