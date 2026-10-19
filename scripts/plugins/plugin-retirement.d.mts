export interface PluginRetirementInput {
  pluginId: string;
  installedManifests: readonly any[];
  /** Explicit evidence produced by the durable-reference query; omission fails closed. */
  durableReferencedAgentIds: readonly string[];
  activeBindingPluginIds?: readonly string[];
  agentMapping?: Readonly<Record<string, string>>;
}
export interface PluginRetirementPlan {
  schemaVersion: 1;
  kind: "plugin-retirement";
  action: "remove" | "migrate";
  pluginId: string;
  retiredAgentIds: string[];
  referencedRetiredAgentIds: string[];
  agentMapping?: Record<string, string>;
  migrationSteps?: Array<{ from: string; to: string }>;
  migrated: false;
}
export declare function planPluginRetirement(input: PluginRetirementInput): PluginRetirementPlan;
export declare function planPluginRetirement(
  pluginId: string,
  installedManifests: readonly any[],
  durableReferencedAgentIds: readonly string[],
  activeBindingPluginIds?: readonly string[],
  agentMapping?: Readonly<Record<string, string>>
): PluginRetirementPlan;
