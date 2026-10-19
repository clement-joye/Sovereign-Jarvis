import { access, constants } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

export async function createPlugin(id, { root = process.cwd() } = {}) {
  if (!PLUGIN_ID_PATTERN.test(id)) {
    throw new Error("Plugin id must be lowercase kebab-case (1-64 characters).");
  }
  const pluginRoot = resolve(root, "plugins", id);
  try {
    await new Promise((resolveAccess, reject) =>
      access(pluginRoot, constants.F_OK, (error) => (error ? reject(error) : resolveAccess()))
    );
    throw new Error(`Plugin already exists: ${id}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(join(pluginRoot, "src"), { recursive: true });
  await mkdir(join(pluginRoot, "resources", id, "skills"), { recursive: true });
  await writeFile(
    join(pluginRoot, "README.md"),
    `# ${id} plugin\n\nDescribe what this plugin contributes, its host configuration and credentials, how to enable it in a workspace, usage examples, approval behavior, and troubleshooting.\n`
  );
  await writeJson(join(pluginRoot, "package.json"), {
    name: `@second-brain/${id}-plugin`,
    version: "0.0.0",
    private: true,
    type: "module",
    exports: {
      ".": { types: "./dist/src/index.d.ts", import: "./dist/src/index.js" },
      "./manifest": { types: "./dist/src/manifest.d.ts", import: "./dist/src/manifest.js" }
    },
    scripts: { build: "tsc -b", test: "vitest run" },
    dependencies: { "@second-brain/plugin-sdk": "workspace:*" }
  });
  await writeFile(
    join(pluginRoot, "tsconfig.json"),
    '{\n  "extends": "../../tsconfig.base.json",\n  "compilerOptions": { "composite": true, "rootDir": ".", "outDir": "dist" },\n  "references": [{ "path": "../../packages/plugin-sdk" }],\n  "include": ["src/**/*.ts"]\n}\n'
  );
  const constant = `${id.replaceAll("-", "_").toUpperCase()}_PLUGIN_MANIFEST_V2`;
  await writeFile(
    join(pluginRoot, "src/index.ts"),
    `export * from "./manifest.js";\nimport { definePluginPackage } from "@second-brain/plugin-sdk";\nimport { ${constant} } from "./manifest.js";\nexport const ${id.replaceAll("-", "_").toUpperCase()}_PLUGIN = definePluginPackage({ manifest: ${constant} });\n`
  );
  await writeFile(
    join(pluginRoot, "src/manifest.ts"),
    `import { definePlugin } from "@second-brain/plugin-sdk";\nexport const ${constant} = definePlugin({ schemaVersion: 2, id: "${id}", displayName: "${id} plugin", activation: "workspace", agents: [{ id: "${id}", runtimeClass: "isolated", promptPath: "${id}/AGENTS.md", skillPaths: ["${id}/skills"], extensionPaths: [], capabilityIds: [], runtimeFeatureIds: [], workspaceAccess: "none", threadContextPolicy: "fresh_session_with_thread_history", model: { providerId: "omlx", modelId: "Qwen3.6-35B-A3B-OptiQ-4bit:profile-qwen-general" }, timeoutSeconds: 60, tokenBudget: 800000, maxConcurrentRunsPerWorkspace: 1 }], localToolProviders: [], brokerProviders: [], runtimeFeatures: [] });\n`
  );
  await writeFile(
    join(pluginRoot, "resources", id, "AGENTS.md"),
    `# ${id}\n\nDescribe this plugin's reviewed contribution.\n`
  );
  await writeFile(join(pluginRoot, "resources", id, "skills", ".gitkeep"), "");
  return pluginRoot;
}

function writeJson(path, value) {
  return writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const id = process.argv[2];
  if (!id) throw new Error("Usage: node scripts/plugins/create-plugin.mjs <id>");
  const path = await createPlugin(id);
  console.log(`Created ${path}. Add it to the installed composition and lock files separately.`);
}
