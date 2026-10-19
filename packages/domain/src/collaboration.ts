import type { DelegationGrantV1, WorkspaceWriteLeaseV1 } from "@second-brain/contracts";

import type { AgentCatalog } from "./agent-catalog.js";

/** Calculates the authority a child receives from role, parent, and grant. */
export function effectiveDelegatedTools(
  catalog: AgentCatalog,
  parentAgentId: string,
  childAgentId: string,
  grant: DelegationGrantV1
): readonly string[] {
  if (grant.childAgentId !== childAgentId) {
    throw new Error("Delegation grant is for a different child agent.");
  }
  const parent = catalog.require(parentAgentId);
  const child = catalog.require(childAgentId);
  if (!parent.delegation?.mayDelegateTo.includes(childAgentId)) {
    throw new Error(`${parentAgentId} may not delegate to ${childAgentId}.`);
  }
  const delegatedToolPolicy = parent.delegation.toolPolicyByAgent[childAgentId];
  if (!delegatedToolPolicy) {
    throw new Error(`${parentAgentId} has no delegated tool policy for ${childAgentId}.`);
  }
  const delegableTools = new Set(delegatedToolPolicy);
  const childTools = new Set(child.toolPolicy);
  const grantedTools = new Set(grant.allowedTools);
  for (const tool of grantedTools) {
    if (!delegableTools.has(tool)) {
      throw new Error(`${parentAgentId} may not delegate tool ${tool} to ${childAgentId}.`);
    }
    if (!childTools.has(tool)) {
      throw new Error(`${childAgentId} does not provide delegated tool ${tool}.`);
    }
    if (isWorkspaceWriteTool(tool) && grant.writablePaths.length === 0) {
      throw new Error(`Delegated workspace write tool ${tool} requires writable paths.`);
    }
    if (isWorkspaceReadTool(tool) && grant.readablePaths.length === 0) {
      throw new Error(`Delegated workspace read tool ${tool} requires readable paths.`);
    }
  }
  return child.toolPolicy.filter((tool) => {
    return grantedTools.has(tool);
  });
}

function isWorkspaceReadTool(tool: string): boolean {
  return tool === "workspace_list" || tool === "workspace_read" || tool === "workspace_grep";
}

function isWorkspaceWriteTool(tool: string): boolean {
  return tool === "workspace_write" || tool === "workspace_edit";
}

export function acquireWorkspaceWriteLease(
  current: WorkspaceWriteLeaseV1 | undefined,
  input: { id: string; workspaceId: string; ownerRunId: string; now: Date; leaseMs: number }
): WorkspaceWriteLeaseV1 {
  if (input.leaseMs <= 0) throw new Error("Workspace write lease duration must be positive.");
  if (
    current &&
    new Date(current.expiresAt) > input.now &&
    current.ownerRunId !== input.ownerRunId
  ) {
    throw new Error(`Workspace ${input.workspaceId} already has an active write lease.`);
  }
  return {
    schemaVersion: 1,
    id: input.id,
    workspaceId: input.workspaceId,
    ownerRunId: input.ownerRunId,
    acquiredAt: input.now.toISOString(),
    expiresAt: new Date(input.now.getTime() + input.leaseMs).toISOString()
  };
}

export function renewWorkspaceWriteLease(
  lease: WorkspaceWriteLeaseV1,
  input: { ownerRunId: string; now: Date; leaseMs: number }
): WorkspaceWriteLeaseV1 {
  if (lease.ownerRunId !== input.ownerRunId) throw new Error("Only the lease owner may renew it.");
  if (new Date(lease.expiresAt) <= input.now)
    throw new Error("Expired workspace write leases cannot renew.");
  return { ...lease, expiresAt: new Date(input.now.getTime() + input.leaseMs).toISOString() };
}

export function canReleaseWorkspaceWriteLease(
  lease: WorkspaceWriteLeaseV1,
  ownerRunId: string
): boolean {
  return lease.ownerRunId === ownerRunId;
}
