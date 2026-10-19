import type {
  AttachmentReferenceV1,
  InboundMessageV1,
  OutboundMessageV1
} from "@second-brain/contracts";
export interface MediaProcessorPort {
  transcribeAudio(attachment: AttachmentReferenceV1): Promise<{ text: string; language?: string }>;
  prepareImage(attachment: AttachmentReferenceV1): Promise<AttachmentReferenceV1>;
  synthesizeAudio(text: string): Promise<AttachmentReferenceV1>;
}
export interface MatrixTransportPort {
  submitInbound(
    message: InboundMessageV1
  ): Promise<{ inboundMessageId: string; duplicate: boolean }>;
  deliverOutbound(message: OutboundMessageV1): Promise<{ externalEventId: string }>;
}
export interface AttachmentStorePort {
  put(input: {
    bytes: Uint8Array;
    reference: AttachmentReferenceV1;
  }): Promise<AttachmentReferenceV1>;
  open(storageKey: string): Promise<Uint8Array>;
  stat(storageKey: string): Promise<AttachmentReferenceV1 | undefined>;
  delete(storageKey: string): Promise<void>;
  listOrphans(before: Date): Promise<string[]>;
}
export interface RetentionRecord {
  id: string;
  workspaceId: string;
  targetType:
    | "inbound_message"
    | "attachment"
    | "pi_session"
    | "outbound_message"
    | "execution_content";
  targetId: string;
  storageKey?: string;
  eligibleAt: Date;
  reason: string;
}
export interface RetentionRepositoryPort {
  listEligible(input: { now: Date; limit: number }): Promise<RetentionRecord[]>;
  tombstone(input: {
    record: RetentionRecord;
    now: Date;
    status: "pending" | "completed";
  }): Promise<void>;
  sanitize(input: { record: RetentionRecord; now: Date }): Promise<void>;
}
