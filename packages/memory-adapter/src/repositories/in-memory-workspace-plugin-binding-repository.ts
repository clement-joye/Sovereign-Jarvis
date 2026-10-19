import type {
  WorkspacePluginBindingListingRepositoryPort,
  WorkspacePluginBindingRepositoryPort
} from "@second-brain/application";

export class InMemoryWorkspacePluginBindingRepository
  implements WorkspacePluginBindingListingRepositoryPort
{
  private readonly bindings = new Map<
    string,
    NonNullable<Awaited<ReturnType<WorkspacePluginBindingRepositoryPort["get"]>>>
  >();

  async upsert(
    input: Parameters<WorkspacePluginBindingRepositoryPort["upsert"]>[0]
  ): Promise<void> {
    this.bindings.set(`${input.workspaceId}:${input.pluginId}`, {
      workspaceId: input.workspaceId,
      pluginId: input.pluginId,
      pluginVersion: input.pluginVersion,
      enabledAgents: input.enabledAgents,
      configuration: input.configuration,
      ...(input.credentialRef ? { credentialRef: input.credentialRef } : {})
    });
  }

  async get(workspaceId: string, pluginId: string) {
    return this.bindings.get(`${workspaceId}:${pluginId}`);
  }

  async list(workspaceId: string) {
    return [...this.bindings.values()]
      .filter((binding) => binding.workspaceId === workspaceId)
      .sort((left, right) => left.pluginId.localeCompare(right.pluginId));
  }

  async disable(workspaceId: string, pluginId: string): Promise<boolean> {
    return this.bindings.delete(`${workspaceId}:${pluginId}`);
  }
}
