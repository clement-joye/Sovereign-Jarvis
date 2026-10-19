import { createHash } from "node:crypto";

export function workspaceVolumeName(workspaceId: string): string {
  validateWorkspaceId(workspaceId);
  return `jarvis-workspace-data-${workspaceId}`;
}

export function workspaceSessionVolumeName(workspaceId: string, runtimeClass: string): string {
  validateWorkspaceId(workspaceId);
  return `jarvis-workspace-sessions-${workspaceId}-${runtimeClass}`;
}

export function runtimeName(workspaceId: string, runtimeClass: string): string {
  validateWorkspaceId(workspaceId);
  return `jarvis-workspace-${workspaceId}-${runtimeClass}`;
}

export function runtimeEndpointName(workspaceId: string, runtimeClass: string): string {
  validateWorkspaceId(workspaceId);
  const digest = createHash("sha256").update(workspaceId).digest("hex").slice(0, 24);
  return `jarvis-runtime-${runtimeClass}-${digest}`;
}

function validateWorkspaceId(workspaceId: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(workspaceId)) throw new Error("Invalid workspace runtime id");
}
