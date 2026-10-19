import type {
  AgentCatalog,
  ClockPort,
  IdGeneratorPort,
  WorkspaceRecord
} from "@second-brain/domain";
import type { WorkspaceRepositoryPort } from "../../ports.js";

export const DEFAULT_ROOM_TEMPLATE_ID = "second-brain";
export const DEFAULT_ROOM_TEMPLATE_VERSION = "1.0.0";

export interface WorkspaceInvitationAcceptance {
  workspace: WorkspaceRecord;
  created: boolean;
}

/**
 * Creates an immediately usable Brain room for a trusted Matrix invitation.
 * Replayed invite events return the original workspace so Matrix sync retries
 * cannot create a second workspace for the same room.
 */
export class WorkspaceInvitationService {
  constructor(
    private readonly workspaces: WorkspaceRepositoryPort,
    private readonly ids: IdGeneratorPort,
    private readonly clock: ClockPort,
    private readonly agentCatalog?: Pick<AgentCatalog, "defaultAgentId">
  ) {}

  async acceptTrustedInvite(roomId: string): Promise<WorkspaceInvitationAcceptance> {
    const existing = await this.workspaces.getByRoomId(roomId);
    if (existing) return { workspace: existing, created: false };

    const now = this.clock.now();
    const workspace: WorkspaceRecord = {
      id: this.ids.nextId("workspace"),
      templateId: DEFAULT_ROOM_TEMPLATE_ID,
      templateVersion: DEFAULT_ROOM_TEMPLATE_VERSION,
      configuration: {},
      defaultAgent: this.agentCatalog?.defaultAgentId() ?? "brain",
      status: "active",
      origin: "matrix_invite",
      createdAt: now,
      updatedAt: now,
      activatedAt: now
    };
    const created = await this.workspaces.create(workspace);
    await this.workspaces.bindRoom({
      id: this.ids.nextId("workspace-room-binding"),
      workspaceId: created.id,
      roomId,
      status: "active",
      createdAt: now
    });
    return { workspace: created, created: true };
  }
}
