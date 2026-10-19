import type { InboundMessageV1, ThreadHistoryItemV1 } from "@second-brain/contracts";
import type { RoomAgentId, SessionRecord } from "@second-brain/domain";
export interface SessionRepositoryPort {
  create(session: SessionRecord): Promise<SessionRecord>;
  getActiveBinding(input: {
    workspaceId?: string;
    conversationId: string;
    threadRootExternalEventId?: string;
    scheduleId?: string;
    agentId?: RoomAgentId;
  }): Promise<SessionRecord | undefined>;
  createAndBind(input: {
    session: SessionRecord;
    workspaceId?: string;
    conversationId: string;
    threadRootExternalEventId?: string;
    scheduleId?: string;
    agentId?: RoomAgentId;
  }): Promise<SessionRecord>;
  activateBinding(input: {
    sessionId: string;
    workspaceId?: string;
    conversationId: string;
    threadRootExternalEventId?: string;
    scheduleId?: string;
    agentId?: RoomAgentId;
  }): Promise<SessionRecord>;
  get(id: string, workspaceId?: string): Promise<SessionRecord | undefined>;
  listRecent(input: {
    workspaceId?: string;
    now: Date;
    limit: number;
    includeClosed: boolean;
  }): Promise<SessionRecord[]>;
  touch(input: { sessionId: string; workspaceId?: string; now: Date }): Promise<SessionRecord>;
  close(input: { sessionId: string; workspaceId?: string; now: Date }): Promise<SessionRecord>;
}
export interface ConversationPreferencePort {
  getVoiceReplies(input: {
    workspaceId?: string;
    conversationId: string;
    threadRootExternalEventId?: string;
  }): Promise<boolean>;
  setVoiceReplies(input: {
    workspaceId?: string;
    conversationId: string;
    threadRootExternalEventId?: string;
    enabled: boolean;
  }): Promise<boolean>;
  getSessionContext?(input: ConversationPreferenceScope): Promise<SessionContextPreference>;
  setSessionContext?(
    input: ConversationPreferenceScope & SessionContextPreference
  ): Promise<SessionContextPreference>;
}
export interface ConversationPreferenceScope {
  workspaceId?: string;
  conversationId: string;
  threadRootExternalEventId?: string;
}
export interface SessionContextPreference {
  mode?: "persistent" | undefined;
  historyLimit?: number | undefined;
}
export interface InboundMessageRepositoryPort {
  create(
    message: InboundMessageV1
  ): Promise<
    { message: InboundMessageV1; duplicate: false } | { message: InboundMessageV1; duplicate: true }
  >;
  get(id: string): Promise<InboundMessageV1 | undefined>;
  getByTransportEvent(input: {
    transport: InboundMessageV1["transport"];
    externalEventId: string;
  }): Promise<InboundMessageV1 | undefined>;
  saveAudioTranscript(input: { id: string; workspaceId: string; text: string }): Promise<void>;
  listThreadHistory?(input: {
    message: InboundMessageV1;
    limit: number;
  }): Promise<ThreadHistoryItemV1[]>;
}
