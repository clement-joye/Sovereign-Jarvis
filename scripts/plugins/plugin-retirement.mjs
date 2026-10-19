import { readFile, writeFile } from "node:fs/promises";

/**
 * Build a reviewable plugin retirement plan. This function is deliberately
 * side-effect free: applying a plan belongs to a separately reviewed flow.
 *
 * The positional form is retained for small callers while the object form is
 * convenient for JSON/CLI integrations.
 */
export function planPluginRetirement(
  pluginIdOrInput,
  installedManifests,
  durableReferencedAgentIds,
  activeBindingPluginIds = [],
  agentMapping
) {
  const input =
    typeof pluginIdOrInput === "object" && pluginIdOrInput !== null
      ? pluginIdOrInput
      : {
          pluginId: pluginIdOrInput,
          installedManifests,
          durableReferencedAgentIds,
          activeBindingPluginIds,
          agentMapping
        };
  const pluginId = input.pluginId;
  if (typeof pluginId !== "string" || pluginId.length === 0)
    throw new Error("Plugin id is required.");
  if (!Array.isArray(input.installedManifests))
    throw new Error("Installed plugin manifests must be an array.");
  if (!Array.isArray(input.durableReferencedAgentIds)) {
    throw new Error(
      "Explicit durable-reference evidence is required as an array of referenced agent ids."
    );
  }
  const manifest = input.installedManifests.find((candidate) => candidate?.id === pluginId);
  if (!manifest) throw new Error(`Unknown plugin: ${pluginId}.`);
  if (manifest.activation === "built-in")
    throw new Error(`Cannot retire built-in plugin: ${pluginId}.`);
  const activeBindings = input.activeBindingPluginIds ?? [];
  if (!Array.isArray(activeBindings))
    throw new Error("Active binding plugin ids must be an array.");
  if (activeBindings.includes(pluginId))
    throw new Error(`Plugin has active workspace bindings: ${pluginId}.`);

  const retiredAgentIds = agentIds(manifest);
  const referenced = input.durableReferencedAgentIds;
  const retiredSet = new Set(retiredAgentIds);
  const referencedRetiredAgentIds = [
    ...new Set(referenced.filter((id) => retiredSet.has(id)))
  ].sort();
  const mappingProvided = input.agentMapping !== undefined;
  let migration;
  if (mappingProvided) {
    migration = validateMapping(
      input.agentMapping,
      retiredAgentIds,
      input.installedManifests,
      retiredSet
    );
  } else if (referencedRetiredAgentIds.length > 0) {
    throw new Error(
      `Durable references require an agent mapping: ${referencedRetiredAgentIds.join(", ")}.`
    );
  }

  if (!mappingProvided) {
    return Object.freeze({
      schemaVersion: 1,
      kind: "plugin-retirement",
      action: "remove",
      pluginId,
      retiredAgentIds,
      referencedRetiredAgentIds,
      migrated: false
    });
  }
  return Object.freeze({
    schemaVersion: 1,
    kind: "plugin-retirement",
    action: "migrate",
    pluginId,
    retiredAgentIds,
    referencedRetiredAgentIds,
    agentMapping: Object.fromEntries(
      Object.entries(migration).sort(([a], [b]) => a.localeCompare(b))
    ),
    migrationSteps: Object.entries(migration)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([from, to]) => ({ from, to })),
    migrated: false
  });
}

function agentIds(manifest) {
  const ids = Array.isArray(manifest.agents)
    ? manifest.agents.map((agent) => agent?.id)
    : Array.isArray(manifest.eligibleAgents)
      ? manifest.eligibleAgents
      : [];
  if (
    ids.some((id) => typeof id !== "string" || id.length === 0) ||
    new Set(ids).size !== ids.length
  ) {
    throw new Error(`Invalid agent closure for plugin: ${manifest.id}.`);
  }
  return [...ids].sort();
}

function validateMapping(mapping, retiredAgentIds, manifests, retiredSet) {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping))
    throw new Error("Agent mapping must be an object.");
  const keys = Object.keys(mapping).sort();
  if (
    keys.length !== retiredAgentIds.length ||
    keys.some((id, index) => id !== retiredAgentIds[index])
  ) {
    throw new Error("Agent mapping must cover every retired agent exactly once.");
  }
  const available = new Set(manifests.flatMap(agentIds));
  for (const id of retiredAgentIds) {
    const target = mapping[id];
    if (typeof target !== "string" || target.length === 0 || !available.has(target)) {
      throw new Error(`Invalid replacement agent mapping for ${id}.`);
    }
    if (retiredSet.has(target))
      throw new Error(`Replacement agent is also being retired: ${target}.`);
  }
  return mapping;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
function option(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}
function optionAny(args, names) {
  for (const name of names) {
    const value = option(args, name);
    if (value !== undefined) return value;
  }
  return undefined;
}
function required(args, name, aliases = []) {
  const value = optionAny(args, [name, ...aliases]);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}
function arrayDocument(value, key, label) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.[key])) return value[key];
  throw new Error(`${label} must be an array or an object with an array ${key} field.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  try {
    const manifestsPath = optionAny(args, ["--manifests", "--installed-manifests"]);
    const manifestsDoc = manifestsPath
      ? await readJson(manifestsPath)
      : {
          manifests: (await import("../../packages/installed-plugins/src/catalog.ts"))
            .INSTALLED_PLUGIN_MANIFESTS_V2
        };
    const referencedDoc = required(args, "--referenced-agents", ["--durable-references"]);
    const bindingsDoc = optionAny(args, ["--active-bindings", "--bindings"]);
    const mappingPath = optionAny(args, ["--mapping", "--agent-mapping"]);
    const plan = planPluginRetirement({
      pluginId: required(args, "--plugin"),
      installedManifests: arrayDocument(manifestsDoc, "manifests", "Installed manifests"),
      durableReferencedAgentIds: arrayDocument(
        await readJson(referencedDoc),
        "agentIds",
        "Durable-reference evidence"
      ),
      activeBindingPluginIds: bindingsDoc
        ? arrayDocument(await readJson(bindingsDoc), "pluginIds", "Active bindings")
        : [],
      ...(mappingPath ? { agentMapping: await readJson(mappingPath) } : {})
    });
    const rendered = `${JSON.stringify(plan, null, 2)}\n`;
    const output = optionAny(args, ["--output", "--plan"]);
    if (output) await writeFile(output, rendered, "utf8");
    else process.stdout.write(rendered);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
