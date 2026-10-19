import type { WorkspaceWriteLeaseV1 } from "@second-brain/contracts";
import type {
  RoomAgentId,
  WorkspaceRecord,
  WorkspaceRoomBindingRecord
} from "@second-brain/domain";
export interface WorkspaceRepositoryPort {
  create(workspace: WorkspaceRecord): Promise<WorkspaceRecord>;
  update(workspace: WorkspaceRecord): Promise<WorkspaceRecord>;
  get(id: string): Promise<WorkspaceRecord | undefined>;
  list(): Promise<WorkspaceRecord[]>;
  getByRoomId(roomId: string): Promise<WorkspaceRecord | undefined>;
  getActiveByRoomId(roomId: string): Promise<WorkspaceRecord | undefined>;
  bindRoom(binding: WorkspaceRoomBindingRecord): Promise<WorkspaceRoomBindingRecord>;
  getThreadAgent?(input: {
    workspaceId: string;
    conversationId: string;
    threadRootExternalEventId: string;
  }): Promise<RoomAgentId | undefined>;
  setThreadAgent?(input: {
    workspaceId: string;
    conversationId: string;
    threadRootExternalEventId: string;
    agentId: RoomAgentId;
    updatedAt: Date;
  }): Promise<void>;
}

/** Agent identifiers referenced by durable records that constrain catalog retirement. */
export interface DurableAgentReferenceRepositoryPort {
  listReferencedAgentIds(): Promise<string[]>;
}

/** Durable non-secret enablement for a reviewed capability plugin. */
export interface WorkspacePluginBinding {
  workspaceId: string;
  pluginId: string;
  pluginVersion: string;
  enabledAgents: RoomAgentId[];
  configuration: Record<string, unknown>;
  credentialRef?: string;
}

export interface WorkspacePluginBindingRepositoryPort {
  upsert(input: {
    workspaceId: string;
    pluginId: string;
    pluginVersion: string;
    enabledAgents: RoomAgentId[];
    configuration: Record<string, unknown>;
    credentialRef?: string;
    updatedAt: Date;
  }): Promise<void>;
  get(workspaceId: string, pluginId: string): Promise<WorkspacePluginBinding | undefined>;
  /** Idempotently disables a workspace plugin by removing its durable binding. */
  disable(workspaceId: string, pluginId: string): Promise<boolean>;
}

/** Binding repository capability used by workspace-wide plugin discovery. */
export interface WorkspacePluginBindingListingRepositoryPort
  extends WorkspacePluginBindingRepositoryPort {
  list(workspaceId: string): Promise<WorkspacePluginBinding[]>;
}

/** Durable exclusive lease for mutations to a shared workspace branch. */
export interface WorkspaceWriteLeaseRepositoryPort {
  acquire(input: WorkspaceWriteLeaseV1, now: Date): Promise<WorkspaceWriteLeaseV1 | undefined>;
  renew(input: WorkspaceWriteLeaseV1, now: Date): Promise<WorkspaceWriteLeaseV1 | undefined>;
  release(input: { workspaceId: string; ownerRunId: string }): Promise<boolean>;
  get(workspaceId: string): Promise<WorkspaceWriteLeaseV1 | undefined>;
}
