export type WorkspaceRuntimeHealth =
  | "unprovisioned"
  | "provisioning"
  | "ready"
  | "unhealthy"
  | "archived";

export interface WorkspaceRuntimeDescriptor {
  workspaceId: string;
  templateId: string;
  templateVersion: string;
  health: WorkspaceRuntimeHealth;
}
