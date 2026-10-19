import type { PluginManifestV2 } from "@second-brain/contracts/platform-catalog";

import { byPath, digestBytes } from "./platform-catalog-digest.js";

export function validatePluginResources(
  manifest: PluginManifestV2,
  files: ReadonlyMap<string, string | Uint8Array>
): void {
  for (const agent of manifest.agents) {
    requireFile(files, agent.promptPath, `Agent ${agent.id} prompt`);
    for (const path of [...agent.skillPaths, ...agent.extensionPaths]) {
      if (!files.has(path) && ![...files.keys()].some((file) => file.startsWith(`${path}/`))) {
        throw new Error(
          `Agent ${agent.id} resource does not exist in plugin ${manifest.id}: ${path}.`
        );
      }
    }
  }
}

export function normalizePluginFiles(
  files: ReadonlyMap<string, string | Uint8Array>
): ReadonlyMap<string, string | Uint8Array> {
  const result = new Map<string, string | Uint8Array>();
  for (const [path, content] of files) {
    if (
      path.startsWith("/") ||
      path.includes("\\") ||
      path.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
    )
      throw new Error(`Plugin package contains an unsafe resource path: ${path}.`);
    if (result.has(path)) throw new Error(`Plugin package contains duplicate resource: ${path}.`);
    result.set(path, content);
  }
  return result;
}

export function agentResourceDigests(
  agent: PluginManifestV2["agents"][number],
  files: ReadonlyMap<string, string | Uint8Array>
): Array<{ path: string; digest: string }> {
  const roots = [agent.promptPath, ...agent.skillPaths, ...agent.extensionPaths];
  return [...files.entries()]
    .filter(([path]) => roots.some((root) => path === root || path.startsWith(`${root}/`)))
    .map(([path, content]) => ({ path, digest: digestBytes(content) }))
    .sort(byPath);
}

function requireFile(
  files: ReadonlyMap<string, string | Uint8Array>,
  path: string,
  label: string
): void {
  if (!files.has(path)) throw new Error(`${label} does not exist in its plugin package: ${path}.`);
}
