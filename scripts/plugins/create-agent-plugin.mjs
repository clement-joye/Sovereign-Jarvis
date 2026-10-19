import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const AGENT_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

export async function createAgentPlugin(id, { root = process.cwd() } = {}) {
  if (!AGENT_ID_PATTERN.test(id)) {
    throw new Error("Agent id must be lowercase kebab-case (1-64 characters).");
  }
  const pluginRoot = resolve(root, "plugins", id);
  try {
    await access(pluginRoot, constants.F_OK);
    throw new Error(`Agent plugin already exists: ${id}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(join(pluginRoot, "resources", id, "skills"), { recursive: true });
  await writeFile(
    join(pluginRoot, "README.md"),
    `# ${id} agent plugin\n\nDescribe this agent's purpose, configuration, selection and usage, capabilities, limitations, and troubleshooting.\n`
  );
  await writeJson(join(pluginRoot, "package.json"), {
    name: `@second-brain/${id}-plugin`,
    version: "0.0.0",
    private: true,
    type: "module"
  });
  await writeJson(join(pluginRoot, "agent.manifest.json"), agentManifestV2(id));
  await writeFile(
    join(pluginRoot, "resources", id, "AGENTS.md"),
    `# ${id}\n\nDescribe the reviewed ${id} agent role here.\n`
  );
  await writeFile(join(pluginRoot, "resources", id, "skills", ".gitkeep"), "");
  const lockPath = resolve(root, "plugins/agents.lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  if (lock?.schemaVersion !== 1 || !Array.isArray(lock.agents)) {
    throw new Error("Invalid plugins/agents.lock.json.");
  }
  lock.agents = [...lock.agents, { id, manifest: `plugins/${id}/agent.manifest.json` }].sort(
    (a, b) => a.id.localeCompare(b.id)
  );
  await writeJson(lockPath, lock);
  return pluginRoot;
}

function agentManifestV2(id) {
  return {
    schemaVersion: 2,
    id,
    displayName: `${id} agent`,
    activation: "built-in",
    agents: [
      {
        id,
        runtimeClass: "isolated",
        promptPath: `${id}/AGENTS.md`,
        skillPaths: [`${id}/skills`],
        extensionPaths: [],
        capabilityIds: [],
        runtimeFeatureIds: [],
        workspaceAccess: "scoped-write",
        threadContextPolicy: "fresh_session_with_thread_history",
        model: {
          providerId: "omlx",
          modelId: "Qwen3.6-35B-A3B-OptiQ-4bit:profile-qwen-general"
        },
        timeoutSeconds: 300,
        tokenBudget: 800000,
        maxConcurrentRunsPerWorkspace: 1
      }
    ],
    localToolProviders: [],
    brokerProviders: [],
    runtimeFeatures: []
  };
}

function writeJson(path, value) {
  return writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const id = process.argv[2];
  if (!id) throw new Error("Usage: pnpm agent:new <id>");
  await createAgentPlugin(id);
}
