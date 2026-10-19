import type {
  AttachmentReferenceV1,
  InboundMessageV1,
  InternalJobV1,
  OutboundMessageV1,
  PiRunRequestV1,
  ScheduledJobV1
} from "./schemas.js";

export const exampleAttachment: AttachmentReferenceV1 = {
  schemaVersion: 1,
  id: "attachment-1",
  workspaceId: "workspace-example",
  purpose: "inbound",
  mediaType: "image/jpeg",
  sizeBytes: 1024,
  sha256: "0".repeat(64),
  storageKey: "inbound/message-1/attachment-1",
  originalFilename: "photo.jpg",
  width: 1280,
  height: 720
};

export const exampleInboundMessage: InboundMessageV1 = {
  schemaVersion: 1,
  id: "inbound-1",
  traceId: "trace-1",
  transport: "matrix",
  externalEventId: "$matrix-event-1",
  conversationId: "!room:example",
  workspaceId: "workspace-example",
  senderId: "@owner:example",
  receivedAt: "2026-07-17T15:00:00.000Z",
  kind: "text",
  text: "Remember this note.",
  attachments: [],
  metadata: {}
};

export const examplePiRunRequest: PiRunRequestV1 = {
  schemaVersion: 1,
  id: "pi-run-1",
  workspaceId: "workspace-example",
  traceId: "trace-1",
  sessionId: "session-1",
  inputText: "Remember this note.",
  images: [],
  attachments: [],
  sourceReferences: [],
  timeoutSeconds: 120,
  priority: "interactive"
};

export const exampleScheduledJob: ScheduledJobV1 = {
  schemaVersion: 1,
  id: "schedule-1",
  workspaceId: "workspace-example",
  destinationConversationId: "!room:example",
  agentId: "brain",
  name: "Daily review",
  instruction: "Summarize today's notes.",
  schedule: { type: "cron", expression: "0 20 * * *", timezone: "Europe/Stockholm" },
  enabled: true,
  sessionPolicy: { type: "fresh" },
  notificationPolicy: "always",
  overlapPolicy: "skip",
  missedRunPolicy: "run_once",
  timeoutSeconds: 600,
  nextRunAt: "2026-07-17T18:00:00.000Z",
  version: 1,
  createdAt: "2026-07-17T15:00:00.000Z",
  updatedAt: "2026-07-17T15:00:00.000Z"
};

export const exampleJob: InternalJobV1 = {
  schemaVersion: 1,
  id: "job-1",
  workspaceId: "workspace-example",
  type: "process_inbound",
  payload: { inboundMessageId: "inbound-1" },
  priority: 100,
  status: "pending",
  attempts: 0,
  availableAt: "2026-07-17T15:00:00.000Z",
  idempotencyKey: "matrix:$matrix-event-1"
};

export const exampleOutboundMessage: OutboundMessageV1 = {
  schemaVersion: 1,
  id: "outbound-1",
  traceId: "trace-1",
  conversationId: "!room:example",
  workspaceId: "workspace-example",
  text: "Done.",
  images: [],
  files: [],
  presentation: "assistant",
  urgency: "normal",
  idempotencyKey: "outbound:trace-1:done"
};
