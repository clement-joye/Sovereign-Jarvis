import type { ActionApprovalPolicyRepositoryPort } from "@second-brain/application";

export class InMemoryActionApprovalPolicyRepository implements ActionApprovalPolicyRepositoryPort {
  private readonly ownerRequired = new Set<string>();

  async getMode(
    workspaceId: string,
    pluginId: string,
    operationId: string
  ): Promise<"owner" | undefined> {
    return this.ownerRequired.has(this.key(workspaceId, pluginId, operationId))
      ? "owner"
      : undefined;
  }

  async replaceOwnerRequiredOperations(input: {
    workspaceId: string;
    pluginId: string;
    operationIds: readonly string[];
    updatedAt: Date;
  }): Promise<void> {
    void input.updatedAt;
    const prefix = `${input.workspaceId}\u0000${input.pluginId}\u0000`;
    for (const key of this.ownerRequired) {
      if (key.startsWith(prefix)) this.ownerRequired.delete(key);
    }
    for (const operationId of new Set(input.operationIds)) {
      this.ownerRequired.add(this.key(input.workspaceId, input.pluginId, operationId));
    }
  }

  private key(workspaceId: string, pluginId: string, operationId: string): string {
    return `${workspaceId}\u0000${pluginId}\u0000${operationId}`;
  }
}
