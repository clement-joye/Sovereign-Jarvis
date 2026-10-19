import { access, readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPlugin } from "../../../../scripts/plugins/create-plugin.mjs";

interface ScaffoldPackageJson {
  dependencies: Record<string, string>;
  exports: Record<string, { types: string; import: string }>;
}

interface ScaffoldTsconfigJson {
  references: Array<{ path: string }>;
  include: string[];
}

describe("createPlugin", () => {
  it("scaffolds an uninstalled workspace plugin", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-plugin-"));
    const path = await createPlugin("research-tools", { root });
    const manifestSource = await readFile(join(path, "src/manifest.ts"), "utf8");
    expect(manifestSource).toContain("definePlugin");
    expect(manifestSource).toMatch(/agents:\s*\[\s*\{[\s\S]+?id:\s*"research-tools"/);
    expect(manifestSource).toContain("tokenBudget: 800000");
    await expect(access(join(path, "plugin.yaml"))).rejects.toThrow();
    expect(await readFile(join(path, "README.md"), "utf8")).toContain("# research-tools plugin");
    expect(await readFile(join(path, "src/index.ts"), "utf8")).toContain("definePluginPackage");
    const packageJson = JSON.parse(
      await readFile(join(path, "package.json"), "utf8")
    ) as unknown as ScaffoldPackageJson;
    expect(packageJson.dependencies["@second-brain/plugin-sdk"]).toBe("workspace:*");
    expect(packageJson.exports).toEqual({
      ".": { types: "./dist/src/index.d.ts", import: "./dist/src/index.js" },
      "./manifest": { types: "./dist/src/manifest.d.ts", import: "./dist/src/manifest.js" }
    });
    const tsconfig = JSON.parse(
      await readFile(join(path, "tsconfig.json"), "utf8")
    ) as unknown as ScaffoldTsconfigJson;
    expect(tsconfig.references).toEqual([{ path: "../../packages/plugin-sdk" }]);
    expect(tsconfig.include).toEqual(["src/**/*.ts"]);
    await access(join(path, "resources/research-tools/AGENTS.md"));
  });
  it("rejects unsafe and existing IDs", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-plugin-"));
    await expect(createPlugin("Bad_ID", { root })).rejects.toThrow();
    await createPlugin("existing", { root });
    await expect(createPlugin("existing", { root })).rejects.toThrow("already exists");
  });
});
