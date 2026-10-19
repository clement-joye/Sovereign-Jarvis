import { describe, expect, it, vi } from "vitest";

import type { InboundMessageV1, InternalJobV1 } from "@second-brain/contracts";
import { exampleInboundMessage } from "@second-brain/contracts";
import type { IdGeneratorPort } from "@second-brain/domain";

import { InboundAcceptanceService, inboundRequiresRootAdmission } from "./inbound-acceptance.js";
import type { InboundMessageRepositoryPort, JobQueuePort } from "../../ports.js";

describe("InboundAcceptanceService", () => {
  it("stores a new Matrix message and enqueues process_inbound once", async () => {
    const inboundMessages = new InMemoryInboundMessageRepository();
    const jobs = new InMemoryJobQueue();
    const service = new InboundAcceptanceService({
      inboundMessages,
      jobs,
      ids: new SequentialIdGenerator(),
      now: () => new Date("2026-07-17T15:00:00.000Z")
    });

    const first = await service.acceptMatrixInbound(exampleInboundMessage);
    const second = await service.acceptMatrixInbound({
      ...exampleInboundMessage,
      id: "inbound-duplicate-body"
    });

    expect(first).toEqual({ inboundMessageId: "inbound-1", duplicate: false, jobId: "job-1" });
    expect(second).toEqual({ inboundMessageId: "inbound-1", duplicate: true, jobId: "job-1" });
    expect(inboundMessages.snapshot()).toHaveLength(1);
    expect(jobs.snapshot()).toHaveLength(1);
    expect(jobs.snapshot()[0]).toMatchObject({
      type: "process_inbound",
      payload: { inboundMessageId: "inbound-1", agentId: "brain" },
      priority: 100,
      idempotencyKey: "workspace-example:matrix:$matrix-event-1:process_inbound"
    });
  });

  it("records the active run for a cancel command in the same thread", async () => {
    const jobs = Object.assign(new InMemoryJobQueue(), {
      cancelLatestInboundTurn: vi.fn().mockResolvedValue({
        runId: "job-active",
        needsPiCancel: true
      })
    });
    const service = new InboundAcceptanceService({
      inboundMessages: new InMemoryInboundMessageRepository(),
      jobs,
      ids: new SequentialIdGenerator(),
      now: () => new Date("2026-07-17T15:00:00.000Z")
    });
    const message = {
      ...exampleInboundMessage,
      text: "/cancel",
      threadRootExternalEventId: "$thread"
    };

    const first = await service.acceptMatrixInbound(message);
    const duplicate = await service.acceptMatrixInbound({ ...message, id: "inbound-retry" });

    expect(first.cancelTargetRunId).toBe("job-active");
    expect(first.cancelTargetNeedsPiCancel).toBe(true);
    expect(duplicate.cancelTargetRunId).toBe("job-active");
    expect(jobs.cancelLatestInboundTurn).toHaveBeenCalledExactlyOnceWith({
      workspaceId: "workspace-example",
      conversationId: exampleInboundMessage.conversationId,
      threadRootExternalEventId: "$thread",
      excludeInboundMessageId: exampleInboundMessage.id
    });
    expect(jobs.snapshot()[0]?.payload.cancelTargetRunId).toBe("job-active");
  });
});

describe("inboundRequiresRootAdmission", () => {
  it("keeps deterministic commands and implicit room session creation off the model lane", () => {
    expect(inboundRequiresRootAdmission({ ...exampleInboundMessage, text: "/help" })).toBe(false);
    expect(inboundRequiresRootAdmission(exampleInboundMessage)).toBe(false);
  });

  it("requires admission for a threaded model turn", () => {
    expect(
      inboundRequiresRootAdmission({
        ...exampleInboundMessage,
        threadRootExternalEventId: "$thread"
      })
    ).toBe(true);
  });
});

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
  private readonly transportEvents = new Map<string, string>();

  async create(
    message: InboundMessageV1
  ): Promise<
    { message: InboundMessageV1; duplicate: false } | { message: InboundMessageV1; duplicate: true }
  > {
    const key = `${message.transport}:${message.externalEventId}`;
    const existingId = this.transportEvents.get(key);
    if (existingId) {
      return { message: this.messages.get(existingId)!, duplicate: true };
    }
    this.messages.set(message.id, message);
    this.transportEvents.set(key, message.id);
    return { message, duplicate: false };
  }

  async get(id: string): Promise<InboundMessageV1 | undefined> {
    return this.messages.get(id);
  }

  async getByTransportEvent(input: {
    transport: InboundMessageV1["transport"];
    externalEventId: string;
  }): Promise<InboundMessageV1 | undefined> {
    const id = this.transportEvents.get(`${input.transport}:${input.externalEventId}`);
    return id ? this.messages.get(id) : undefined;
  }

  async saveAudioTranscript(): Promise<void> {}

  snapshot(): InboundMessageV1[] {
    return [...this.messages.values()];
  }
}

class InMemoryJobQueue implements JobQueuePort {
  private readonly jobs = new Map<string, InternalJobV1>();

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

  async claim(): Promise<InternalJobV1[]> {
    return [];
  }

  async complete(): Promise<void> {
    return undefined;
  }

  async fail(): Promise<InternalJobV1> {
    throw new Error("Not implemented in this test fake.");
  }

  snapshot(): InternalJobV1[] {
    return [...this.jobs.values()];
  }
}
