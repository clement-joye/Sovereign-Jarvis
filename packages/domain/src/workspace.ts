export const WORKSPACE_STATUSES = [
  "pending_invite",
  "configuring",
  "provisioning",
  "active",
  "archived",
  "closed",
  "failed"
] as const;

export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

/** Rejects unresolved transport data before it reaches durable workspace state. */
export function requireWorkspaceId(workspaceId: string | undefined, context = "operation"): string {
  if (!workspaceId) throw new Error(`${context} requires an explicit workspace ID.`);
  return workspaceId;
}
import type { AgentId } from "./agent-catalog.js";

/** A workspace stores a catalog-validated role ID. */
export type RoomAgentId = AgentId;

export interface WorkspaceRecord {
  id: string;
  templateId: string;
  templateVersion: string;
  configuration: Record<string, unknown>;
  /** Agent selected for new conversations in this room. */
  defaultAgent?: RoomAgentId;
  status: WorkspaceStatus;
  origin: "legacy_seed" | "matrix_invite";
  createdAt: Date;
  updatedAt: Date;
  activatedAt?: Date;
  archivedAt?: Date;
  closedAt?: Date;
}

export interface WorkspaceRoomBindingRecord {
  id: string;
  workspaceId: string;
  roomId: string;
  status: "active" | "archived";
  createdAt: Date;
  archivedAt?: Date;
}

const ALLOWED_TRANSITIONS: Readonly<Record<WorkspaceStatus, readonly WorkspaceStatus[]>> = {
  pending_invite: ["configuring", "closed"],
  configuring: ["provisioning", "archived", "closed"],
  provisioning: ["active", "failed", "archived", "closed"],
  active: ["provisioning", "archived", "closed"],
  archived: ["provisioning", "closed"],
  closed: [],
  failed: ["configuring", "provisioning", "archived", "closed"]
};

export function canTransitionWorkspace(from: WorkspaceStatus, to: WorkspaceStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function transitionWorkspace(
  workspace: WorkspaceRecord,
  to: WorkspaceStatus,
  now: Date
): WorkspaceRecord {
  if (!canTransitionWorkspace(workspace.status, to)) {
    throw new Error(`Cannot transition workspace from ${workspace.status} to ${to}.`);
  }

  return {
    ...workspace,
    status: to,
    updatedAt: now,
    ...(to === "active" ? { activatedAt: now } : {}),
    ...(to === "archived" ? { archivedAt: now } : {}),
    ...(to === "closed" ? { closedAt: now } : {})
  };
}

export type WorkspaceCommand =
  | { type: "status" }
  | { type: "use-template"; templateId: string }
  | { type: "configure"; answer: string }
  | { type: "confirm" }
  | { type: "archive" }
  | { type: "not-workspace-command" }
  | { type: "invalid"; message: string };

export function parseWorkspaceCommand(text: string): WorkspaceCommand {
  const trimmed = text.trim();
  if (trimmed !== "/workspace" && !trimmed.startsWith("/workspace ")) {
    return { type: "not-workspace-command" };
  }
  const [, action, ...rest] = trimmed.split(/\s+/);
  const argument = rest.join(" ").trim();
  if (action === "status" && !argument) return { type: "status" };
  if (action === "use") {
    return argument
      ? { type: "use-template", templateId: argument }
      : { type: "invalid", message: "/workspace use requires a template id." };
  }
  if (action === "configure") {
    return argument
      ? { type: "configure", answer: argument }
      : { type: "invalid", message: "/workspace configure requires an answer." };
  }
  if (action === "confirm" && !argument) return { type: "confirm" };
  if (action === "archive" && !argument) return { type: "archive" };
  return {
    type: "invalid",
    message:
      "Use /workspace status, use <template>, configure <field>=<value>, confirm, or archive."
  };
}
