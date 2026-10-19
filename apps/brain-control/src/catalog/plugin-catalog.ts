import type { CompiledPluginV2, PlatformCatalogV2 } from "@second-brain/contracts";

/** Immutable plugin-management view compiled into the reviewed platform catalog. */
export class PluginCatalog {
  private constructor(private readonly plugins: ReadonlyMap<string, CompiledPluginV2>) {}

  static fromPlatformCatalog(catalog: Readonly<PlatformCatalogV2>): PluginCatalog {
    return new PluginCatalog(new Map(catalog.plugins.map((plugin) => [plugin.id, plugin])));
  }

  get(id: string): CompiledPluginV2 | undefined {
    return this.plugins.get(id);
  }

  list(): CompiledPluginV2[] {
    return [...this.plugins.values()].sort((left, right) => left.id.localeCompare(right.id));
  }
}
