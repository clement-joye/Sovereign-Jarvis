import { describe, expect, it, vi } from "vitest";

import {
  exampleInboundMessage,
  type AttachmentReferenceV1,
  type InboundMessageV1,
  type InternalJobV1,
  type OutboundMessageV1,
  type PiRunRequestV1,
  type PiRunResultV1,
  type ScheduledExecutionV1,
  type ScheduledJobV1
} from "@second-brain/contracts";
import {
  INITIAL_AGENT_CATALOG,
  type ClockPort,
  type IdGeneratorPort,
  type SessionRecord
} from "@second-brain/domain";

import type {
  AgentCollaborationRepositoryPort,
  ExecutionRepositoryPort,
  ConversationPreferencePort,
  InboundMessageRepositoryPort,
  JobQueuePort,
  MediaProcessorPort,
  OutboundJobCompletionPort,
  OutboundRepositoryPort,
  PiRunnerPort,
  ScheduleRepositoryPort,
  SessionRepositoryPort
} from "../ports.js";
import { ScheduleService } from "../scheduling/commands/schedules.js";
import { SessionRoutingService } from "../sessions/routing/session-routing.js";
import { WorkerOrchestrationService } from "./worker-orchestration.js";

// Shorter comment than above: Returns an inbound message with a thread root.
function threadedInbound(): InboundMessageV1 {
  return {
    ...exampleInboundMessage,
    threadRootExternalEventId: exampleInboundMessage.externalEventId
  };
}

describe("WorkerOrchestrationService", () => {
  describe("poll lifecycle", () => {
    it("shares an active poll instead of claiming jobs concurrently", async () => {
      const subject = createSubject();
      const claimGate = deferred<void>();
      subject.jobs.claimGate = claimGate.promise;

      const first = subject.worker.pollOnce();
      await subject.jobs.waitForClaim();
      const second = subject.worker.pollOnce();

      expect(subject.jobs.claimCalls).toBe(1);
      claimGate.resolve();
      await expect(Promise.all([first, second])).resolves.toEqual([
        { claimed: 0, completed: 0, failed: 0 },
        { claimed: 0, completed: 0, failed: 0 }
      ]);

      await subject.worker.pollOnce();
      expect(subject.jobs.claimCalls).toBe(2);
    });

    it("cancels model work before an unconfirmed admission lease can expire", async () => {
      const clock = new MutableClock("2026-07-17T15:00:00.000Z");
      const jobs = new FailingRenewJobQueue(clock);
      const pi = new LeaseAwarePiRunner();
      const subject = createSubject({ clock, jobs, pi });
      await subject.inboundMessages.create(threadedInbound());
      await jobs.enqueue(
        job({
          id: "job-1",
          payload: {
            inboundMessageId: "inbound-1",
            admissionHeartbeatMs: 10,
            admissionLeaseMs: 30
          }
        })
      );

      const poll = subject.worker.pollOnce();
      await pi.started;
      await vi.waitFor(() => expect(pi.cancelledRuns).toEqual(["job-1"]));
      await expect(poll).resolves.toEqual({ claimed: 1, completed: 0, failed: 1 });
      expect(jobs.renewCalls).toBe(2);
      expect(jobs.snapshot()[0]?.status).toBe("leased");
    });
  });

  describe("inbound conversation jobs", () => {
    it("processes an inbound message through session routing, media, Pi, and idempotent outbound", async () => {
      const subject = createSubject();
      await subject.inboundMessages.create(threadedInbound());
      await subject.jobs.enqueue(job({ id: "job-1", payload: { inboundMessageId: "inbound-1" } }));

      const first = await subject.worker.pollOnce();
      await subject.jobs.enqueue(
        job({
          id: "job-2",
          idempotencyKey: "job-2",
          payload: { inboundMessageId: "inbound-1" }
        })
      );
      const second = await subject.worker.pollOnce();

      expect(first).toEqual({ claimed: 1, completed: 1, failed: 0 });
      expect(second).toEqual({ claimed: 1, completed: 1, failed: 0 });
      expect(subject.pi.requests).toHaveLength(1);
      expect(subject.outbounds.snapshot()).toHaveLength(1);
      expect(subject.outbounds.snapshot()[0]).toMatchObject({
        conversationId: exampleInboundMessage.conversationId,
        text: "pi response",
        replyToExternalEventId: exampleInboundMessage.externalEventId,
        threadRootExternalEventId: exampleInboundMessage.externalEventId,
        idempotencyKey: "process_inbound:inbound-1:outbound"
      });
    });

    it("creates command responses without invoking Pi", async () => {
      const subject = createSubject();
      await subject.inboundMessages.create({
        ...exampleInboundMessage,
        id: "inbound-command",
        externalEventId: "$command",
        kind: "command",
        text: "/sessions"
      });
      await subject.jobs.enqueue(
        job({
          id: "job-1",
          idempotencyKey: "command",
          payload: { inboundMessageId: "inbound-command" }
        })
      );

      await expect(subject.worker.pollOnce()).resolves.toEqual({
        claimed: 1,
        completed: 1,
        failed: 0
      });
      expect(subject.pi.requests).toHaveLength(0);
      expect(subject.outbounds.snapshot()[0]).toMatchObject({
        text: "No recent sessions. Send a message or use `/new` to start one.",
        presentation: "notice",
        replyToExternalEventId: "$command",
        threadRootExternalEventId: "$command"
      });
    });

    it("uses the thread root rather than the latest message as the reply fallback", async () => {
      const subject = createSubject();
      await subject.inboundMessages.create({
        ...exampleInboundMessage,
        id: "inbound-thread-follow-up",
        externalEventId: "$latest-message",
        threadRootExternalEventId: "$thread-root"
      });
      await subject.jobs.enqueue(
        job({
          id: "job-thread-follow-up",
          idempotencyKey: "job-thread-follow-up",
          payload: { inboundMessageId: "inbound-thread-follow-up" }
        })
      );

      await subject.worker.pollOnce();

      expect(subject.outbounds.snapshot()[0]).toMatchObject({
        replyToExternalEventId: "$thread-root",
        threadRootExternalEventId: "$thread-root"
      });
    });

    it("reports when no response is running without cancelling a stale Pi session", async () => {
      const subject = createSubject();
      await subject.inboundMessages.create(threadedInbound());
      await subject.jobs.enqueue(job({ id: "job-1", payload: { inboundMessageId: "inbound-1" } }));
      await subject.worker.pollOnce();
      await subject.inboundMessages.create({
        ...exampleInboundMessage,
        id: "inbound-cancel",
        externalEventId: "$cancel",
        kind: "command",
        text: "/cancel",
        threadRootExternalEventId: exampleInboundMessage.externalEventId
      });
      await subject.jobs.enqueue(
        job({
          id: "job-2",
          idempotencyKey: "job-2",
          payload: { inboundMessageId: "inbound-cancel" }
        })
      );

      await subject.worker.pollOnce();
      expect(subject.pi.cancelledSessions).toEqual([]);
      expect(subject.outbounds.snapshot().at(-1)?.text).toBe(
        "No response is running in this thread."
      );
    });

    it("acknowledges an ingress-selected cancellation without exposing session IDs", async () => {
      const subject = createSubject();
      await subject.inboundMessages.create({
        ...exampleInboundMessage,
        id: "inbound-cancel",
        externalEventId: "$cancel",
        kind: "command",
        text: "/cancel",
        threadRootExternalEventId: "$thread-root"
      });
      await subject.jobs.enqueue(
        job({
          id: "job-cancel",
          payload: { inboundMessageId: "inbound-cancel", cancelTargetRunId: "job-active" }
        })
      );

      await subject.worker.pollOnce();

      expect(subject.outbounds.snapshot()[0]?.text).toBe("Stopping the current response.");
      expect(subject.pi.cancelledSessions).toEqual([]);
    });
  });

  describe("scheduled jobs", () => {
    it("runs schedules and honors notification policy", async () => {
      const subject = createSubject();
      const scheduleService = new ScheduleService({
        schedules: subject.schedules,
        executions: subject.executions,
        jobs: subject.jobs,
        clock: subject.clock,
        ids: subject.ids
      });
      const created = await scheduleService.create({
        workspaceId: "workspace-example",
        destinationConversationId: "!room:example",
        name: "Daily check",
        instruction: "summarize memory",
        schedule: { type: "interval", seconds: 3600, timezone: "Europe/Stockholm" },
        notificationPolicy: "never"
      });
      const execution = await scheduleService.runNow(created.schedule.id, "manual-1");

      await expect(subject.worker.pollOnce()).resolves.toEqual({
        claimed: 1,
        completed: 1,
        failed: 0
      });
      expect(subject.pi.requests).toHaveLength(1);
      expect(subject.outbounds.snapshot()).toHaveLength(0);
      await expect(subject.executions.get(execution.id)).resolves.toMatchObject({
        status: "succeeded",
        resultFingerprint: "ca728e88"
      });
      const completedExecution = await subject.executions.get(execution.id);
      expect(completedExecution?.sessionId).toBeDefined();
      await expect(
        subject.sessions.get(completedExecution?.sessionId ?? "")
      ).resolves.toMatchObject({
        sourceType: "scheduled",
        sourceScheduleId: created.schedule.id
      });
    });
  });

  describe("job completion", () => {
    it("delivers one delayed progress notice only while the root run is active", async () => {
      const root = {
        schemaVersion: 1 as const,
        id: "root-1",
        workspaceId: "workspace-example",
        agentId: "planner",
        catalogVersion: "1.0.0",
        catalogDigest: `sha256:${"a".repeat(64)}`,
        effectivePolicyDigest: `sha256:${"b".repeat(64)}`,
        platformPolicyDigest: `sha256:${"c".repeat(64)}`,
        resourceDigest: `sha256:${"d".repeat(64)}`,
        runtimeImageId: "image-v1",
        status: "running" as const,
        rootRunId: "root-1",
        deadlineAt: "2026-07-17T15:10:00.000Z",
        timeoutSeconds: 600,
        tokenBudget: 1000,
        createdAt: "2026-07-17T15:00:00.000Z",
        noticeOrigin: {
          conversationId: "!origin:example",
          replyToExternalEventId: "$reply",
          threadRootExternalEventId: "$thread"
        }
      };
      const subject = createSubject({
        collaboration: {
          getRun: vi.fn().mockResolvedValue(root),
          listChildren: vi.fn().mockResolvedValue([
            { agentId: "browser", status: "running" },
            { agentId: "document-analyzer", status: "queued" },
            { agentId: "calendar", status: "completed" }
          ] as never)
        }
      });
      await subject.jobs.enqueue(
        job({
          id: "progress-job-1",
          type: "progress_notice",
          workspaceId: "workspace-example",
          payload: { rootRunId: "root-1" },
          idempotencyKey: "progress_notice:workspace-example:root-1"
        })
      );

      await expect(subject.worker.pollOnce()).resolves.toMatchObject({ completed: 1, failed: 0 });
      expect(subject.outbounds.snapshot()).toHaveLength(1);
      expect(subject.outbounds.snapshot()[0]).toMatchObject({
        conversationId: "!origin:example",
        replyToExternalEventId: "$reply",
        threadRootExternalEventId: "$thread",
        text: "Browser and Document Analyzer are still working…",
        presentation: "notice",
        idempotencyKey: "progress_notice:workspace-example:root-1:sent"
      });
      expect(subject.outbounds.snapshot()[0]?.text).not.toContain("root-1");
    });

    it("sends one safe failure notice in the originating thread after terminal failure", async () => {
      const subject = createSubject({ pi: new TerminalFailingPiRunner() });
      await subject.inboundMessages.create({
        ...threadedInbound(),
        threadRootExternalEventId: "$origin-thread"
      });
      await subject.jobs.enqueue(
        job({
          id: "job-fail-1",
          payload: { inboundMessageId: "inbound-1" }
        })
      );
      await subject.worker.pollOnce();

      expect(
        subject.outbounds.snapshot().map((outbound) => ({
          id: outbound.id,
          workspaceId: outbound.workspaceId,
          idempotencyKey: outbound.idempotencyKey
        }))
      ).toEqual([
        {
          id: expect.any(String),
          workspaceId: "workspace-example",
          idempotencyKey: "process_inbound:inbound-1:terminal_failure"
        }
      ]);
      expect(subject.outbounds.snapshot()[0]).toMatchObject({
        conversationId: exampleInboundMessage.conversationId,
        replyToExternalEventId: "$origin-thread",
        threadRootExternalEventId: "$origin-thread",
        text: "I couldn’t complete that request. Please try again later.",
        presentation: "error",
        idempotencyKey: "process_inbound:inbound-1:terminal_failure"
      });
      expect(subject.outbounds.snapshot()[0]?.text).not.toContain("internal");

      await subject.jobs.enqueue(
        job({
          id: "job-fail-retry",
          idempotencyKey: "job-fail-retry",
          payload: { inboundMessageId: "inbound-1" }
        })
      );
      await subject.worker.pollOnce();
      expect(subject.outbounds.snapshot()).toHaveLength(1);
    });

    it("dead-letters terminal worker failures", async () => {
      const onJobFailure = vi.fn();
      const subject = createSubject({ onJobFailure });
      await subject.jobs.enqueue(job({ id: "job-1", payload: {} }));

      await expect(subject.worker.pollOnce()).resolves.toEqual({
        claimed: 1,
        completed: 0,
        failed: 1
      });
      expect(subject.jobs.snapshot()[0]).toMatchObject({
        id: "job-1",
        status: "dead_letter",
        attempts: 1
      });
      expect(onJobFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: "job-1",
          jobType: "process_inbound",
          error: expect.objectContaining({
            message: "Job job-1 is missing payload.inboundMessageId."
          })
        })
      );
    });

    it("uses atomic outbound completion when the completion port is present", async () => {
      const completions = new RecordingOutboundCompletion();
      const subject = createSubject({ completions });
      await subject.inboundMessages.create(threadedInbound());
      await subject.jobs.enqueue(job({ id: "job-1", payload: { inboundMessageId: "inbound-1" } }));

      await expect(subject.worker.pollOnce()).resolves.toEqual({
        claimed: 1,
        completed: 1,
        failed: 0
      });

      expect(completions.calls).toHaveLength(1);
      expect(completions.calls[0]).toMatchObject({
        jobId: "job-1",
        leaseOwner: "worker-1",
        outbound: { idempotencyKey: "process_inbound:inbound-1:outbound" }
      });
      expect(subject.jobs.snapshot()[0]?.status).toBe("leased");
      expect(subject.outbounds.snapshot()).toHaveLength(0);
    });
  });

  describe("outbound response selection", () => {
    it("creates an audio-only outbound for opted-in voice-note input", async () => {
      const subject = createSubject({ voiceRepliesEnabled: true });
      await subject.inboundMessages.create({
        ...threadedInbound(),
        attachments: [audioAttachment()]
      });
      await subject.jobs.enqueue(job({ id: "job-1", payload: { inboundMessageId: "inbound-1" } }));

      await expect(subject.worker.pollOnce()).resolves.toEqual({
        claimed: 1,
        completed: 1,
        failed: 0
      });
      expect(subject.pi.requests[0]?.inputText).toBe(
        [
          "[Attachments available in this request]",
          "- Audio: id=audio-1; type=audio/ogg; size=5 bytes.",
          "[/Attachments available in this request]",
          "transcribed:audio-1"
        ].join("\n")
      );
      const [outbound] = subject.outbounds.snapshot();
      expect(subject.outbounds.snapshot()).toHaveLength(1);
      expect(outbound).toMatchObject({
        idempotencyKey: "process_inbound:inbound-1:outbound",
        audio: { mediaType: "audio/ogg" }
      });
      expect(outbound).not.toHaveProperty("text");
    });

    it("falls back to text when voice synthesis is unavailable", async () => {
      const subject = createSubject({
        voiceRepliesEnabled: true,
        media: new UnavailableTtsMediaProcessor()
      });
      await subject.inboundMessages.create({
        ...threadedInbound(),
        attachments: [audioAttachment()]
      });
      await subject.jobs.enqueue(job({ id: "job-1", payload: { inboundMessageId: "inbound-1" } }));

      await expect(subject.worker.pollOnce()).resolves.toEqual({
        claimed: 1,
        completed: 1,
        failed: 0
      });
      const [outbound] = subject.outbounds.snapshot();
      expect(subject.outbounds.snapshot()).toHaveLength(1);
      expect(outbound).toMatchObject({
        idempotencyKey: "process_inbound:inbound-1:outbound",
        text: "pi response"
      });
      expect(outbound).not.toHaveProperty("audio");
    });

    it("completes a cancelled Pi run without sending another reply", async () => {
      const subject = createSubject({ pi: new CancelledPiRunner() });
      await subject.inboundMessages.create(threadedInbound());
      await subject.jobs.enqueue(job({ id: "job-1", payload: { inboundMessageId: "inbound-1" } }));

      await expect(subject.worker.pollOnce()).resolves.toEqual({
        claimed: 1,
        completed: 1,
        failed: 0
      });
      expect(subject.outbounds.snapshot()).toEqual([]);
      expect(subject.jobs.snapshot()[0]).toMatchObject({ id: "job-1", status: "completed" });
    });
  });
});

function createSubject(
  options: {
    completions?: OutboundJobCompletionPort;
    voiceRepliesEnabled?: boolean;
    media?: MediaProcessorPort;
    pi?: PiRunnerPort;
    jobs?: InMemoryJobQueue;
    clock?: ClockPort;
    onJobFailure?: (input: {
      jobId: string;
      jobType: InternalJobV1["type"];
      error: unknown;
    }) => void;
    collaboration?: Pick<AgentCollaborationRepositoryPort, "getRun" | "listChildren">;
  } = {}
) {
  const clock = options.clock ?? new FakeClock("2026-07-17T15:00:00.000Z");
  const ids = new SequentialIdGenerator();
  const jobs = options.jobs ?? new InMemoryJobQueue();
  const inboundMessages = new InMemoryInboundMessageRepository();
  const sessions = new InMemorySessionRepository();
  const schedules = new InMemoryScheduleRepository();
  const executions = new InMemoryExecutionRepository();
  const outbounds = new InMemoryOutboundRepository();
  const pi = new DeterministicPiRunner();
  const workerPi = options.pi ?? pi;
  const media = options.media ?? new DeterministicMediaProcessor();
  const preferences = new FixedConversationPreferences(options.voiceRepliesEnabled ?? false);
  const sessionRouting = new SessionRoutingService({
    sessions,
    preferences,
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
    sessions,
    preferences,
    schedules,
    executions,
    outbounds,
    ...(options.completions ? { outboundCompletions: options.completions } : {}),
    sessionRouting,
    pi: workerPi,
    activeCatalog: INITIAL_AGENT_CATALOG,
    media,
    ids,
    clock,
    ...(options.onJobFailure ? { onJobFailure: options.onJobFailure } : {}),
    ...(options.collaboration
      ? { collaboration: options.collaboration as AgentCollaborationRepositoryPort }
      : {}),
    config: {
      workerId: "worker-1",
      leaseMs: 30_000,
      claimLimit: 10,
      jobTypes: ["process_inbound", "run_schedule", "run_agent", "progress_notice"],
      maxAttempts: 3,
      retryBaseDelayMs: 1_000,
      piTimeoutSeconds: 600
    }
  });
  return {
    clock,
    ids,
    jobs,
    inboundMessages,
    sessions,
    schedules,
    executions,
    outbounds,
    pi,
    worker
  };
}

function job(overrides: Partial<InternalJobV1>): InternalJobV1 {
  return {
    schemaVersion: 1,
    id: "job",
    type: "process_inbound",
    payload: {},
    priority: 100,
    status: "pending",
    attempts: 0,
    availableAt: "2026-07-17T14:00:00.000Z",
    idempotencyKey: "job",
    ...overrides
  };
}

class FakeClock implements ClockPort {
  constructor(private readonly value: string) {}

  now(): Date {
    return new Date(this.value);
  }
}

class MutableClock implements ClockPort {
  private value: Date;

  constructor(value: string) {
    this.value = new Date(value);
  }

  now(): Date {
    return new Date(this.value);
  }

  advance(milliseconds: number): void {
    this.value = new Date(this.value.getTime() + milliseconds);
  }
}

class FixedConversationPreferences implements ConversationPreferencePort {
  constructor(private readonly enabled: boolean) {}
  async getVoiceReplies(): Promise<boolean> {
    return this.enabled;
  }
  async setVoiceReplies(input: { enabled: boolean }): Promise<boolean> {
    return input.enabled;
  }
}

function audioAttachment(): AttachmentReferenceV1 {
  return {
    schemaVersion: 1,
    id: "audio-1",
    purpose: "inbound",
    mediaType: "audio/ogg",
    sizeBytes: 5,
    sha256: "a".repeat(64),
    storageKey: "inbound/audio-1.ogg"
  };
}

class SequentialIdGenerator implements IdGeneratorPort {
  private next = 1;

  nextId(prefix: string): string {
    const id = `${prefix}-${this.next}`;
    this.next += 1;
    return id;
  }
}

class InMemoryInboundMessageRepository implements InboundMessageRepositoryPort {
  private readonly messages = new Map<string, InboundMessageV1>();

  async create(
    message: InboundMessageV1
  ): Promise<{ message: InboundMessageV1; duplicate: false }> {
    this.messages.set(message.id, message);
    return { message, duplicate: false };
  }

  async get(id: string): Promise<InboundMessageV1 | undefined> {
    return this.messages.get(id);
  }

  async getByTransportEvent(): Promise<InboundMessageV1 | undefined> {
    return undefined;
  }

  async saveAudioTranscript(): Promise<void> {}
}

class InMemorySessionRepository implements SessionRepositoryPort {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly bindings = new Map<string, string>();

  async getActiveBinding(input: {
    conversationId: string;
    threadRootExternalEventId?: string;
    scheduleId?: string;
  }): Promise<SessionRecord | undefined> {
    const id = this.bindings.get(
      `${input.conversationId}:${input.threadRootExternalEventId ?? ""}:${input.scheduleId ?? ""}`
    );
    return id ? this.sessions.get(id) : undefined;
  }

  async create(session: SessionRecord): Promise<SessionRecord> {
    this.sessions.set(session.id, session);
    return session;
  }

  async createAndBind(input: {
    session: SessionRecord;
    conversationId: string;
    threadRootExternalEventId?: string;
    scheduleId?: string;
  }): Promise<SessionRecord> {
    await this.create(input.session);
    this.bindings.set(
      `${input.conversationId}:${input.threadRootExternalEventId ?? ""}:${input.scheduleId ?? ""}`,
      input.session.id
    );
    return input.session;
  }

  async activateBinding(input: {
    sessionId: string;
    conversationId: string;
    threadRootExternalEventId?: string;
    scheduleId?: string;
  }): Promise<SessionRecord> {
    const session = this.sessions.get(input.sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${input.sessionId}`);
    }
    await this.createAndBind({ session, ...input });
    return session;
  }

  async get(id: string): Promise<SessionRecord | undefined> {
    return this.sessions.get(id);
  }

  async listRecent(): Promise<SessionRecord[]> {
    return [...this.sessions.values()];
  }

  async touch(input: { sessionId: string; now: Date }): Promise<SessionRecord> {
    const session = this.sessions.get(input.sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${input.sessionId}`);
    }
    const updated = { ...session, lastActiveAt: input.now };
    this.sessions.set(updated.id, updated);
    return updated;
  }

  async close(input: { sessionId: string; now: Date }): Promise<SessionRecord> {
    const session = await this.touch(input);
    const closed: SessionRecord = { ...session, status: "closed" };
    this.sessions.set(closed.id, closed);
    return closed;
  }
}

class InMemoryScheduleRepository implements ScheduleRepositoryPort {
  private readonly schedules = new Map<string, ScheduledJobV1>();

  async create(job: ScheduledJobV1): Promise<ScheduledJobV1> {
    this.schedules.set(job.id, job);
    return job;
  }

  async get(id: string): Promise<ScheduledJobV1 | undefined> {
    return this.schedules.get(id);
  }

  async list(): Promise<ScheduledJobV1[]> {
    return [...this.schedules.values()];
  }

  async update(job: ScheduledJobV1): Promise<ScheduledJobV1> {
    this.schedules.set(job.id, job);
    return job;
  }

  async delete(): Promise<ScheduledJobV1> {
    throw new Error("Not needed in this test.");
  }

  async claimDue(): Promise<ScheduledJobV1[]> {
    return [];
  }

  async hardDeleteDisabledOlderThan(): Promise<number> {
    return 0;
  }
}

class InMemoryExecutionRepository implements ExecutionRepositoryPort {
  private readonly executions = new Map<string, ScheduledExecutionV1>();

  async create(
    execution: ScheduledExecutionV1
  ): Promise<{ execution: ScheduledExecutionV1; duplicate: false }> {
    this.executions.set(execution.id, execution);
    return { execution, duplicate: false };
  }

  async get(id: string): Promise<ScheduledExecutionV1 | undefined> {
    return this.executions.get(id);
  }

  async listBySchedule(scheduleId: string): Promise<ScheduledExecutionV1[]> {
    return [...this.executions.values()].filter((execution) => execution.scheduleId === scheduleId);
  }

  async findActiveBySchedule(scheduleId: string): Promise<ScheduledExecutionV1 | undefined> {
    return [...this.executions.values()].find(
      (execution) =>
        execution.scheduleId === scheduleId &&
        (execution.status === "created" ||
          execution.status === "queued" ||
          execution.status === "running")
    );
  }

  async update(execution: ScheduledExecutionV1): Promise<ScheduledExecutionV1> {
    this.executions.set(execution.id, execution);
    return execution;
  }
}

class InMemoryJobQueue implements JobQueuePort {
  private readonly jobs = new Map<string, InternalJobV1>();
  claimCalls = 0;
  claimGate: Promise<void> | undefined;
  private claimObserved = deferred<void>();

  async enqueue(job: InternalJobV1): Promise<InternalJobV1> {
    const existing = [...this.jobs.values()].find(
      (candidate) => candidate.idempotencyKey === job.idempotencyKey
    );
    if (existing) {
      return existing;
    }
    this.jobs.set(job.id, job);
    return job;
  }

  async claim(input: {
    workerId: string;
    limit: number;
    now: Date;
    leaseMs: number;
  }): Promise<InternalJobV1[]> {
    this.claimCalls += 1;
    this.claimObserved.resolve();
    await this.claimGate;
    const claimable = [...this.jobs.values()]
      .filter((candidate) => candidate.status === "pending")
      .slice(0, input.limit);
    const leased = claimable.map((candidate) => ({
      ...candidate,
      status: "leased" as const,
      leaseOwner: input.workerId,
      leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs).toISOString()
    }));
    for (const candidate of leased) {
      this.jobs.set(candidate.id, candidate);
    }
    return leased;
  }

  async complete(input: { jobId: string }): Promise<void> {
    const job = this.jobs.get(input.jobId);
    if (!job) {
      throw new Error(`Unknown job: ${input.jobId}`);
    }
    this.jobs.set(job.id, { ...job, status: "completed" });
  }

  async fail(input: {
    jobId: string;
    now: Date;
    retryable: boolean;
    reason: string;
    retryDelayMs?: number;
    maxAttempts: number;
  }): Promise<InternalJobV1> {
    const job = this.jobs.get(input.jobId);
    if (!job) {
      throw new Error(`Unknown job: ${input.jobId}`);
    }
    const updated: InternalJobV1 = {
      ...job,
      status: "dead_letter",
      attempts: job.attempts + 1,
      availableAt: input.now.toISOString(),
      payload: { ...job.payload, lastError: input.reason }
    };
    this.jobs.set(job.id, updated);
    return updated;
  }

  snapshot(): InternalJobV1[] {
    return [...this.jobs.values()];
  }

  async waitForClaim(): Promise<void> {
    await this.claimObserved.promise;
  }
}

class FailingRenewJobQueue extends InMemoryJobQueue {
  renewCalls = 0;

  constructor(private readonly clock: MutableClock) {
    super();
  }

  async renew(): Promise<boolean> {
    this.renewCalls += 1;
    this.clock.advance(10);
    throw new Error("control plane unavailable");
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolveDeferred!: (value: T) => void;
  let rejectDeferred!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });
  return { promise, resolve: resolveDeferred, reject: rejectDeferred };
}

class InMemoryOutboundRepository implements OutboundRepositoryPort {
  private readonly messages = new Map<string, OutboundMessageV1>();
  private readonly idempotencyKeys = new Map<string, string>();

  async create(message: OutboundMessageV1): Promise<OutboundMessageV1> {
    const idempotencyKey = `${message.workspaceId ?? ""}\u001f${message.idempotencyKey}`;
    const existingId = this.idempotencyKeys.get(idempotencyKey);
    if (existingId) return this.messages.get(existingId)!;
    this.messages.set(message.id, message);
    this.idempotencyKeys.set(idempotencyKey, message.id);
    return message;
  }

  async get(id: string): Promise<OutboundMessageV1 | undefined> {
    return this.messages.get(id);
  }

  async getByIdempotencyKey(idempotencyKey: string): Promise<OutboundMessageV1 | undefined> {
    return [...this.messages.values()].find((message) => message.idempotencyKey === idempotencyKey);
  }

  snapshot(): OutboundMessageV1[] {
    return [...this.messages.values()];
  }
}

class RecordingOutboundCompletion implements OutboundJobCompletionPort {
  readonly calls: Array<{
    outbound: OutboundMessageV1;
    jobId: string;
    leaseOwner: string;
  }> = [];

  async createOutboundAndComplete(input: {
    outbound: OutboundMessageV1;
    jobId: string;
    leaseOwner: string;
  }): Promise<OutboundMessageV1> {
    this.calls.push(input);
    return input.outbound;
  }
}

class DeterministicPiRunner implements PiRunnerPort {
  readonly requests: PiRunRequestV1[] = [];
  readonly cancelledSessions: string[] = [];

  async run(request: PiRunRequestV1): Promise<PiRunResultV1> {
    this.requests.push(request);
    return {
      schemaVersion: 1,
      id: request.id,
      traceId: request.traceId,
      sessionId: request.sessionId,
      status: "completed",
      text: "pi response",
      generatedFiles: [],
      startedAt: "2026-07-17T15:00:00.000Z",
      finishedAt: "2026-07-17T15:00:01.000Z"
    };
  }

  async cancel(_runId: string): Promise<void> {
    return undefined;
  }

  async cancelSession(sessionId: string): Promise<void> {
    this.cancelledSessions.push(sessionId);
  }
}

class CancelledPiRunner extends DeterministicPiRunner {
  override async run(request: PiRunRequestV1): Promise<PiRunResultV1> {
    return {
      schemaVersion: 1,
      id: request.id,
      traceId: request.traceId,
      sessionId: request.sessionId,
      status: "cancelled",
      generatedFiles: [],
      startedAt: "2026-07-17T15:00:00.000Z",
      finishedAt: "2026-07-17T15:00:01.000Z"
    };
  }
}

class TerminalFailingPiRunner extends DeterministicPiRunner {
  override async run(): Promise<PiRunResultV1> {
    throw Object.assign(new Error("internal provider response details"), { retryable: false });
  }
}

class LeaseAwarePiRunner extends DeterministicPiRunner {
  readonly cancelledRuns: string[] = [];
  private readonly runStarted = deferred<void>();
  private readonly runFinished = deferred<PiRunResultV1>();
  readonly started = this.runStarted.promise;

  override run(): Promise<PiRunResultV1> {
    this.runStarted.resolve();
    return this.runFinished.promise;
  }

  override async cancel(runId: string): Promise<void> {
    this.cancelledRuns.push(runId);
    this.runFinished.reject(new Error("runtime cancelled"));
  }
}

class DeterministicMediaProcessor implements MediaProcessorPort {
  async transcribeAudio(attachment: AttachmentReferenceV1): Promise<{ text: string }> {
    return { text: `transcribed:${attachment.id}` };
  }

  async prepareImage(attachment: AttachmentReferenceV1): Promise<AttachmentReferenceV1> {
    return { ...attachment, purpose: "prepared" };
  }

  async synthesizeAudio(): Promise<AttachmentReferenceV1> {
    return {
      schemaVersion: 1,
      id: "tts-1",
      purpose: "outbound",
      mediaType: "audio/ogg",
      sizeBytes: 5,
      sha256: "b".repeat(64),
      storageKey: "outbound/audio/tts-1.ogg"
    };
  }
}

class UnavailableTtsMediaProcessor extends DeterministicMediaProcessor {
  override async synthesizeAudio(): Promise<AttachmentReferenceV1> {
    throw new Error("TTS is unavailable");
  }
}
