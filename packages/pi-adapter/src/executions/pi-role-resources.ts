import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import type { AgentCatalog } from "@second-brain/domain";

type ExtensionFactory = NonNullable<
  ConstructorParameters<typeof DefaultResourceLoader>[0]["extensionFactories"]
>[number];

export interface PiRoleResourceOptions {
  profileRoot?: string | undefined;
  resourceRoot?: string | undefined;
  workspaceRoot: string;
}

/** Resolves immutable role resources independently from writable Pi state. */
export class RoleResourceResolver {
  constructor(private readonly options: PiRoleResourceOptions) {}

  resolve(sessionDirectory: string, agent: ReturnType<AgentCatalog["require"]>) {
    return resolvePiRoleResources(this.options, sessionDirectory, agent);
  }

  loadExtensions(extensionPaths: readonly string[]) {
    return this.options.profileRoot
      ? loadRoleExtensionFactories(this.options.profileRoot, extensionPaths)
      : Promise.resolve([]);
  }
}

export async function loadRoleExtensionFactories(
  resourceRoot: string,
  extensionPaths: readonly string[]
): Promise<ExtensionFactory[]> {
  return Promise.all(
    extensionPaths.map(async (path) => {
      const extension = (await import(pathToFileURL(join(resourceRoot, path)).href)) as {
        default?: unknown;
      };
      if (typeof extension.default !== "function") {
        throw new Error(`Reviewed extension has no default factory: ${path}`);
      }
      return extension.default as ExtensionFactory;
    })
  );
}

export function resolvePiRoleResources(
  options: PiRoleResourceOptions,
  sessionDirectory: string,
  agent: ReturnType<AgentCatalog["require"]>
): {
  resourceRoot: string;
  agentDir: string;
  systemPrompt: string;
  additionalSkillPaths: string[];
} {
  const resourceRoot = options.resourceRoot ?? options.profileRoot ?? options.workspaceRoot;
  return {
    resourceRoot,
    // Keep Pi's writable agent state separate from the immutable role profile.
    agentDir: sessionDirectory,
    systemPrompt: join(resourceRoot, agent.promptPath),
    additionalSkillPaths:
      options.resourceRoot || options.profileRoot
        ? agent.skillPaths.map((path) => join(resourceRoot, path))
        : [join(options.workspaceRoot, ".agents", "skills")]
  };
}
