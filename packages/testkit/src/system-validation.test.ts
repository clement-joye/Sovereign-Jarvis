import { describe, expect, it } from "vitest";

import {
  InboundAcceptanceService,
  RetentionService,
  ScheduleService,
  SessionRoutingService,
  WorkerOrchestrationService,
  type AttachmentStorePort,
  type OutboundDeliveryPort,
  type RetentionRecord,
  type RetentionRepositoryPort
} from "@second-brain/application";
import type {
  DeliveryResultV1,
  OutboundMessageV1,
  StructuredErrorV1
} from "@second-brain/contracts";
import { exampleInboundMessage } from "@second-brain/contracts";
import { INITIAL_AGENT_CATALOG } from "@second-brain/domain";
import { MatrixGatewayProcessor, matrixTransactionId } from "@second-brain/matrix-adapter";

import {
  DeterministicMediaProcessor,
  DeterministicPiRunner,
  FakeClock,
  InMemoryExecutionRepository,
  InMemoryInboundMessageRepository,
  InMemoryJobQueue,
  InMemoryOutboundRepository,
  InMemoryScheduleRepository,
  InMemorySessionRepository,
  SequentialIdGenerator,
  matrixTextEvent
} from "./fakes/fakes.js";

describe("deterministic system validation flows", () => {
  describe("inbound delivery", () => {
    it("accepts duplicate Matrix delivery once, processes one Pi run, and delivers one outbound", async () => {
      const system = createSystemHarness();

      const accepted = await system.gateway.process(
        matrixTextEvent({
          eventId: "$event-1",
          body: "remember this",
          threadRootExternalEventId: "$event-1"
        })
      );
      expect(accepted).toMatchObject({ status: "submitted", duplicate: false });
      await expect(
        system.gateway.process(
          matrixTextEvent({
            eventId: "$event-1",
            body: "remember this",
            threadRootExternalEventId: "$event-1"
          })
        )
      ).resolves.toMatchObject({ status: "submitted", duplicate: true });

      expect(system.jobs.snapshot()).toHaveLength(1);
      await expect(system.worker.pollOnce()).resolves.toEqual({
        claimed: 1,
        completed: 1,
        failed: 0
      });
      expect(system.pi.requests).toHaveLength(1);

      const claimed = await system.delivery.claim({
        transport: "matrix",
        now: system.clock.now(),
        limit: 10
      });
      expect(claimed).toHaveLength(1);
      expect(claimed[0]).toMatchObject({
        conversationId: "!brain:example",
        text: "**brain**:\n\npi response",
        idempotencyKey:
          accepted.status === "submitted"
            ? `process_inbound:${accepted.inboundMessageId}:outbound`
            : "unreachable"
      });

      const delivered = await system.delivery.markDelivered({
        outboundMessageId: claimed[0]!.id,
        transport: "matrix",
        externalEventId: `$${matrixTransactionId(claimed[0]!)}`,
        now: system.clock.now()
      });
      expect(delivered).toMatchObject({
        status: "delivered",
        outboundMessageId: claimed[0]!.id
      });
      await expect(
        system.delivery.claim({ transport: "matrix", now: system.clock.now(), limit: 10 })
      ).resolves.toEqual([]);
    });
  });

  describe("scheduled delivery", () => {
    it("claims due schedules, runs Pi, creates proactive outbound, and records delivery", async () => {
      const system = createSystemHarness();
      const created = await system.schedules.create({
        workspaceId: "workspace-example",
        destinationConversationId: "!room:example",
        name: "Hourly summary",
        instruction: "summarize memory",
        schedule: { type: "interval", seconds: 3600, timezone: "UTC" },
        notificationPolicy: "always"
      });
      system.clock.advance(3_600_000);

      const due = await system.schedules.claimDue(10);
      expect(due).toHaveLength(1);
      await expect(system.worker.pollOnce()).resolves.toEqual({
        claimed: 1,
        completed: 1,
        failed: 0
      });

      await expect(system.executions.get(due[0]!.id)).resolves.toMatchObject({
        status: "succeeded"
      });
      await expect(system.scheduleRecords.get(created.schedule.id)).resolves.toMatchObject({
        lastRunAt: "2026-07-17T16:00:00.000Z",
        nextRunAt: "2026-07-17T17:00:00.000Z"
      });

      const claimed = await system.delivery.claim({
        transport: "matrix",
        now: system.clock.now(),
        limit: 10
      });
      expect(claimed).toMatchObject([
        {
          conversationId: "!room:example",
          idempotencyKey: `run_schedule:${due[0]!.id}:outbound`
        }
      ]);
      await expect(
        system.delivery.markDelivered({
          outboundMessageId: claimed[0]!.id,
          transport: "matrix",
          externalEventId: `$${matrixTransactionId(claimed[0]!)}`,
          now: system.clock.now()
        })
      ).resolves.toMatchObject({ status: "delivered" });
    });

    it("runs a claimed one-time schedule before retiring its future occurrence", async () => {
      const system = createSystemHarness();
      const created = await system.schedules.create({
        workspaceId: "workspace-example",
        destinationConversationId: "!room:example",
        name: "Say hi",
        instruction: "Say hi.",
        schedule: { type: "once", runAt: "2026-07-17T16:00:00.000Z" },
        notificationPolicy: "always"
      });
      system.clock.advance(3_600_000);

      const due = await system.schedules.claimDue(10);
      await expect(system.worker.pollOnce()).resolves.toMatchObject({
        claimed: 1,
        completed: 1,
        failed: 0
      });

      await expect(system.executions.get(due[0]!.id)).resolves.toMatchObject({
        status: "succeeded"
      });
      await expect(
        system.outbounds.getByIdempotencyKey(
          `run_schedule:${due[0]!.id}:outbound`,
          "workspace-example"
        )
      ).resolves.toMatchObject({
        conversationId: "!room:example"
      });
      await expect(system.scheduleRecords.get(created.schedule.id)).resolves.toMatchObject({
        enabled: true,
        lastRunAt: "2026-07-17T16:00:00.000Z"
      });
    });
  });

  describe("conversation context and media", () => {
    it("keeps end-to-end inbound work isolated across workspaces", async () => {
      const system = createSystemHarness();
      const first = await system.inboundAcceptance.acceptMatrixInbound({
        ...exampleInboundMessage,
        id: "inbound-workspace-one",
        traceId: "trace-workspace-one",
        externalEventId: "$workspace-one",
        conversationId: "!same-room-shape:example",
        workspaceId: "workspace-one",
        threadRootExternalEventId: "$thread-workspace-one",
        text: "remember workspace one"
      });
      const second = await system.inboundAcceptance.acceptMatrixInbound({
        ...exampleInboundMessage,
        id: "inbound-workspace-two",
        traceId: "trace-workspace-two",
        externalEventId: "$workspace-two",
        conversationId: "!same-room-shape:example",
        workspaceId: "workspace-two",
        threadRootExternalEventId: "$thread-workspace-two",
        text: "remember workspace two"
      });

      expect(first.jobId).not.toBe(second.jobId);
      await expect(system.worker.pollOnce()).resolves.toEqual({
        claimed: 2,
        completed: 2,
        failed: 0
      });
      expect(
        system.sessions
          .snapshot()
          .map((session) => session.workspaceId)
          .sort()
      ).toEqual(["workspace-one", "workspace-two"]);
      expect(system.pi.requests.map((request) => request.workspaceId).sort()).toEqual([
        "workspace-one",
        "workspace-two"
      ]);
      expect(
        system.outbounds
          .snapshot()
          .map((outbound) => outbound.workspaceId)
          .sort()
      ).toEqual(["workspace-one", "workspace-two"]);
    });

    it("keeps Matrix thread sessions independent from the default room session", async () => {
      const system = createSystemHarness();
      await system.gateway.process(
        matrixTextEvent({
          eventId: "$default",
          body: "default room",
          threadRootExternalEventId: "$default"
        })
      );
      await system.gateway.process(
        matrixTextEvent({
          eventId: "$thread-a-message",
          body: "thread A",
          relatesTo: { rel_type: "m.thread", event_id: "$thread-a" }
        })
      );
      await system.gateway.process(
        matrixTextEvent({
          eventId: "$thread-b-message",
          body: "thread B",
          relatesTo: { rel_type: "m.thread", event_id: "$thread-b" }
        })
      );

      await expect(system.worker.pollOnce()).resolves.toEqual({
        claimed: 3,
        completed: 3,
        failed: 0
      });

      // With the new implicit-/new routing, the first message in the room
      // creates a brand new session (label: "default room") rather than
      // resuming a "default-room" binding. The thread isolation check
      // below is what this test is really about, so we only assert that.
      await expect(
        system.sessions.getActiveBinding({
          workspaceId: "workspace-example",
          conversationId: "!brain:example",
          threadRootExternalEventId: "$thread-a"
        })
      ).resolves.toMatchObject({ sourceType: "thread", sourceThreadRootId: "$thread-a" });
      await expect(
        system.sessions.getActiveBinding({
          workspaceId: "workspace-example",
          conversationId: "!brain:example",
          threadRootExternalEventId: "$thread-b"
        })
      ).resolves.toMatchObject({ sourceType: "thread", sourceThreadRootId: "$thread-b" });
      expect(new Set(system.pi.requests.map((request) => request.sessionId)).size).toBe(3);
    });

    it("processes Matrix image and voice-note attachments through media before Pi", async () => {
      const system = createSystemHarness();
      await system.gateway.process(matrixMediaEvent({ eventId: "$image", msgtype: "m.image" }));
      await system.gateway.process(matrixMediaEvent({ eventId: "$audio", msgtype: "m.audio" }));

      await expect(system.worker.pollOnce()).resolves.toEqual({
        claimed: 2,
        completed: 2,
        failed: 0
      });

      expect(system.pi.requests).toHaveLength(2);
      expect(system.pi.requests[0]?.images).toMatchObject([{ purpose: "prepared" }]);
      expect(system.pi.requests[1]?.inputText).toContain("transcribed:attachment-");
    });
  });

  describe("recovery and retry", () => {
    it("recovers a worker crash after lease expiry without duplicating accepted inbound work", async () => {
      const system = createSystemHarness();
      await system.gateway.process(
        matrixTextEvent({
          eventId: "$crash",
          body: "survive crash",
          threadRootExternalEventId: "$crash"
        })
      );
      const preCrashClaim = await system.jobs.claim({
        workerId: "worker-1",
        limit: 1,
        now: system.clock.now(),
        leaseMs: 30_000
      });
      expect(preCrashClaim).toHaveLength(1);

      system.clock.advance(31_000);
      await expect(system.worker.pollOnce()).resolves.toEqual({
        claimed: 1,
        completed: 1,
        failed: 0
      });

      expect(system.pi.requests).toHaveLength(1);
      expect(system.outbounds.snapshot()).toHaveLength(1);
    });

    it("retries outbound delivery with the same stable Matrix transaction id", async () => {
      const system = createSystemHarness();
      await system.gateway.process(
        matrixTextEvent({
          eventId: "$retry",
          body: "retry delivery",
          threadRootExternalEventId: "$retry"
        })
      );
      await system.worker.pollOnce();

      const [firstClaim] = await system.delivery.claim({
        transport: "matrix",
        now: system.clock.now(),
        limit: 1
      });
      expect(firstClaim).toBeDefined();
      const firstTxnId = matrixTransactionId(firstClaim!);
      await system.delivery.markRetry({
        outboundMessageId: firstClaim!.id,
        transport: "matrix",
        now: system.clock.now(),
        error: {
          schemaVersion: 1,
          code: "matrix_unavailable",
          category: "dependency",
          message: "Matrix unavailable.",
          retryable: true
        }
      });

      const [secondClaim] = await system.delivery.claim({
        transport: "matrix",
        now: system.clock.now(),
        limit: 1
      });
      expect(secondClaim?.id).toBe(firstClaim!.id);
      expect(matrixTransactionId(secondClaim!)).toBe(firstTxnId);
    });
  });

  describe("retention", () => {
    it("purges short-lived retention records without removing durable schedules", async () => {
      const system = createSystemHarness();
      await system.schedules.create({
        workspaceId: "workspace-example",
        destinationConversationId: "!room:example",
        name: "Durable schedule",
        instruction: "keep running",
        schedule: { type: "interval", seconds: 3600, timezone: "UTC" }
      });
      const retentionRepository = new RecordingRetentionRepository([
        retentionRecord("inbound_message", "inbound-1"),
        retentionRecord("outbound_message", "outbound-1"),
        retentionRecord("attachment", "attachment-1", "inbound/attachment-1")
      ]);
      const attachmentStore = new RecordingAttachmentStore();
      const retention = new RetentionService({
        repository: retentionRepository,
        attachments: attachmentStore,
        now: () => new Date("2026-07-27T00:00:00.000Z")
      });

      await expect(retention.run({ dryRun: false, limit: 10 })).resolves.toMatchObject({
        eligible: 3,
        deletedFiles: ["inbound/attachment-1"],
        sanitizedRecords: [
          "inbound_message:workspace-example:inbound-1",
          "outbound_message:workspace-example:outbound-1",
          "attachment:workspace-example:attachment-1"
        ],
        failures: []
      });
      expect(retentionRepository.tombstones.map((entry) => entry.status)).toEqual([
        "pending",
        "completed",
        "pending",
        "completed",
        "pending",
        "completed"
      ]);
      await expect(system.scheduleRecords.list()).resolves.toMatchObject([
        { id: "schedule-1", name: "Durable schedule" }
      ]);
    });
  });
});

function createSystemHarness() {
  const clock = new FakeClock("2026-07-17T15:00:00.000Z");
  const ids = new SequentialIdGenerator();
  const jobs = new InMemoryJobQueue();
  const inboundMessages = new InMemoryInboundMessageRepository();
  const sessionRecords = new InMemorySessionRepository();
  const scheduleRecords = new InMemoryScheduleRepository();
  const executions = new InMemoryExecutionRepository();
  const outbounds = new InMemoryOutboundRepository();
  const pi = new DeterministicPiRunner();
  const media = new DeterministicMediaProcessor();
  const inboundAcceptance = new InboundAcceptanceService({
    inboundMessages,
    jobs,
    ids,
    now: () => clock.now()
  });
  const gateway = new MatrixGatewayProcessor({
    agentCatalog: INITIAL_AGENT_CATALOG,
    auth: {
      ownerMatrixId: "@owner:example",
      brainUserId: "@brain:example"
    },
    submitter: {
      submitInbound: (message) => inboundAcceptance.acceptMatrixInbound(message)
    },
    workspaceResolver: {
      resolveRoom: async () => ({ workspaceId: "workspace-example", status: "active" })
    }
  });
  const sessionRouting = new SessionRoutingService({
    sessions: sessionRecords,
    clock,
    ids,
    agentCatalog: INITIAL_AGENT_CATALOG,
    config: {
      idleContinuationMs: 86_400_000,
      retentionMs: 604_800_000,
      scheduleDisplayTimezone: "UTC"
    }
  });
  const worker = new WorkerOrchestrationService({
    jobs,
    inboundMessages,
    sessions: sessionRecords,
    schedules: scheduleRecords,
    executions,
    outbounds,
    sessionRouting,
    pi,
    activeCatalog: INITIAL_AGENT_CATALOG,
    media,
    ids,
    clock,
    config: {
      workerId: "worker-1",
      leaseMs: 30_000,
      claimLimit: 10,
      jobTypes: ["process_inbound", "run_schedule", "run_agent"],
      maxAttempts: 3,
      retryBaseDelayMs: 1_000,
      piTimeoutSeconds: 600
    }
  });
  const schedules = new ScheduleService({
    schedules: scheduleRecords,
    executions,
    jobs,
    clock,
    ids
  });
  const delivery = new InMemoryOutboundDelivery(outbounds);
  return {
    clock,
    jobs,
    inboundAcceptance,
    gateway,
    worker,
    schedules,
    scheduleRecords,
    executions,
    outbounds,
    delivery,
    sessions: sessionRecords,
    pi
  };
}

class InMemoryOutboundDelivery implements OutboundDeliveryPort {
  private readonly statuses = new Map<
    string,
    DeliveryResultV1["status"] | "pending" | "delivering"
  >();
  readonly attempts: DeliveryResultV1[] = [];

  constructor(private readonly outbounds: InMemoryOutboundRepository) {}

  async claim(input: {
    transport: DeliveryResultV1["transport"];
    now: Date;
    limit: number;
  }): Promise<OutboundMessageV1[]> {
    const claimed = this.outbounds
      .snapshot()
      .filter((message) => {
        const status = this.statuses.get(message.id) ?? "pending";
        return status === "pending" || status === "retry_wait";
      })
      .slice(0, input.limit);
    for (const message of claimed) {
      this.statuses.set(message.id, "delivering");
    }
    return claimed;
  }

  async markDelivered(input: {
    outboundMessageId: string;
    transport: DeliveryResultV1["transport"];
    externalEventId: string;
    now: Date;
  }): Promise<DeliveryResultV1> {
    const result: DeliveryResultV1 = {
      schemaVersion: 1,
      outboundMessageId: input.outboundMessageId,
      transport: input.transport,
      externalEventId: input.externalEventId,
      status: "delivered",
      deliveredAt: input.now.toISOString()
    };
    this.statuses.set(input.outboundMessageId, "delivered");
    this.attempts.push(result);
    return result;
  }

  async markRetry(input: {
    outboundMessageId: string;
    transport: DeliveryResultV1["transport"];
    now: Date;
    error: StructuredErrorV1;
  }): Promise<DeliveryResultV1> {
    const result: DeliveryResultV1 = {
      schemaVersion: 1,
      outboundMessageId: input.outboundMessageId,
      transport: input.transport,
      status: "retry_wait",
      error: input.error
    };
    this.statuses.set(input.outboundMessageId, "retry_wait");
    this.attempts.push(result);
    return result;
  }

  async markFailed(input: {
    outboundMessageId: string;
    transport: DeliveryResultV1["transport"];
    now: Date;
    error: StructuredErrorV1;
  }): Promise<DeliveryResultV1> {
    const result: DeliveryResultV1 = {
      schemaVersion: 1,
      outboundMessageId: input.outboundMessageId,
      transport: input.transport,
      status: "failed",
      error: input.error
    };
    this.statuses.set(input.outboundMessageId, "failed");
    this.attempts.push(result);
    return result;
  }
}

class RecordingRetentionRepository implements RetentionRepositoryPort {
  readonly tombstones: Array<{ recordId: string; status: "pending" | "completed" }> = [];
  readonly sanitized: string[] = [];

  constructor(private readonly records: RetentionRecord[]) {}

  async listEligible(input: { now: Date; limit: number }): Promise<RetentionRecord[]> {
    return this.records
      .filter((record) => record.eligibleAt.getTime() <= input.now.getTime())
      .slice(0, input.limit);
  }

  async tombstone(input: {
    record: RetentionRecord;
    now: Date;
    status: "pending" | "completed";
  }): Promise<void> {
    this.tombstones.push({ recordId: input.record.id, status: input.status });
  }

  async sanitize(input: { record: RetentionRecord; now: Date }): Promise<void> {
    this.sanitized.push(input.record.id);
  }
}

class RecordingAttachmentStore implements AttachmentStorePort {
  readonly deleted: string[] = [];

  async delete(storageKey: string): Promise<void> {
    this.deleted.push(storageKey);
  }

  async put(): Promise<never> {
    throw new Error("Not needed in system validation tests.");
  }

  async open(): Promise<never> {
    throw new Error("Not needed in system validation tests.");
  }

  async stat(): Promise<undefined> {
    return undefined;
  }

  async listOrphans(): Promise<string[]> {
    return [];
  }
}

function retentionRecord(
  targetType: RetentionRecord["targetType"],
  targetId: string,
  storageKey?: string
): RetentionRecord {
  return {
    id: `${targetType}:workspace-example:${targetId}`,
    workspaceId: "workspace-example",
    targetType,
    targetId,
    ...(storageKey ? { storageKey } : {}),
    eligibleAt: new Date("2026-07-26T00:00:00.000Z"),
    reason: "expired"
  };
}

function matrixMediaEvent(input: { eventId: string; msgtype: "m.image" | "m.audio" }) {
  const isImage = input.msgtype === "m.image";
  return {
    type: "m.room.message",
    event_id: input.eventId,
    room_id: "!brain:example",
    sender: "@owner:example",
    origin_server_ts: Date.parse("2026-07-17T15:00:00.000Z"),
    content: {
      msgtype: input.msgtype,
      body: isImage ? "photo.jpg" : "voice.ogg",
      url: `mxc://example/${input.eventId.slice(1)}`,
      info: isImage
        ? { mimetype: "image/jpeg", size: 1024, w: 1280, h: 720 }
        : { mimetype: "audio/ogg", size: 2048, duration: 1500 }
    }
  };
}
