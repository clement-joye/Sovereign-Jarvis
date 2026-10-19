import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(appRoot, "src");

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : [path];
    })
  );
  return files.flat();
}

describe("Brain Control production dependency boundary", () => {
  const originalEnvironment = process.env.SECOND_BRAIN_ENVIRONMENT;

  afterEach(() => {
    if (originalEnvironment === undefined) delete process.env.SECOND_BRAIN_ENVIRONMENT;
    else process.env.SECOND_BRAIN_ENVIRONMENT = originalEnvironment;
  });

  it("does not declare or import test-only catalog dependencies at runtime", async () => {
    const manifest = JSON.parse(await readFile(join(appRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, unknown>;
    };
    expect(manifest.dependencies ?? {}).not.toHaveProperty("@second-brain/testkit");
    expect(manifest.dependencies ?? {}).not.toHaveProperty("@second-brain/domain");

    const productionSources = (await sourceFiles(sourceRoot)).filter(
      (path) => !path.endsWith(".test.ts")
    );
    for (const path of productionSources) {
      expect(await readFile(path, "utf8"), path).not.toContain("@second-brain/testkit");
      expect(await readFile(path, "utf8"), path).not.toContain("INITIAL_AGENT_CATALOG");
    }
  });

  it("imports the production entrypoint without composing resources or reading environment", async () => {
    process.env.SECOND_BRAIN_ENVIRONMENT = "production";
    vi.resetModules();

    await expect(import("./index.js")).resolves.toMatchObject({
      createBrainControlComposition: expect.any(Function),
      createBrainControlServer: expect.any(Function),
      startBrainControlFromEnvironment: expect.any(Function)
    });
  }, 30_000);

  it("requires a release catalog or an explicitly injected fixture when composing", async () => {
    const { createBrainControlComposition } = await import("./composition/composition.js");

    await expect(
      createBrainControlComposition({ env: { SECOND_BRAIN_ENVIRONMENT: "dev" } })
    ).rejects.toThrow(
      "PLATFORM_CATALOG_PATH is required unless an agent catalog is explicitly supplied"
    );
  });
});
