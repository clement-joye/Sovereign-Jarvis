import { describe, expect, it } from "vitest";

import type { InternalJobV1, ScheduledExecutionV1, ScheduledJobV1 } from "@second-brain/contracts";
import type { ClockPort, IdGeneratorPort } from "@second-brain/domain";

import { ScheduleService } from "./schedules.js";
import type {
  ExecutionRepositoryPort,
  JobQueuePort,
  ScheduleClaimPort,
  ScheduleRepositoryPort
} from "../../ports.js";

const SCHEDULE_SCOPE = {
  workspaceId: "workspace-example",
  destinationConversationId: "!room:example"
};

describe("ScheduleService", () => {
  describe("schedule definition", () => {
    it("creates a validated schedule with next-three preview", async () => {
      const { service } = createHarness();

      const result = await service.create({
        ...SCHEDULE_SCOPE,
        name: "Daily review",
        instruction: "Summarize notes.",
        schedule: { type: "cron", expression: "0 8 * * *", timezone: "Europe/Stockholm" }
      });

      expect(result.schedule).toMatchObject({
        id: "schedule-1",
        agentId: "brain",
        version: 1,
        enabled: true,
        nextRunAt: "2026-07-18T06:00:00.000Z"
      });
      expect(result.preview.occurrences).toHaveLength(3);
    });

    it("persists and updates the selected schedule executor", async () => {
      const { service } = createHarness();
      await service.create({
        ...SCHEDULE_SCOPE,
        name: "Research",
        instruction: "Find sources.",
        agentId: "browser",
        schedule: { type: "interval", seconds: 3600, timezone: "UTC" }
      });

      await expect(
        service.update({ id: "schedule-1", expectedVersion: 1, agentId: "fixture-agent" })
      ).resolves.toMatchObject({ schedule: { agentId: "fixture-agent", version: 2 } });
    });

    it("keeps a saved thread on ordinary updates and clears it when moving rooms", async () => {
      const { service } = createHarness();
      const created = await service.create({
        ...SCHEDULE_SCOPE,
        destinationThreadRootExternalEventId: "$thread:example",
        name: "Review",
        instruction: "Review notes.",
        schedule: { type: "interval", seconds: 3600, timezone: "UTC" }
      });
      expect(created.schedule.destinationThreadRootExternalEventId).toBe("$thread:example");

      const renamed = await service.update({ id: "schedule-1", expectedVersion: 1, name: "Notes" });
      expect(renamed.schedule.destinationThreadRootExternalEventId).toBe("$thread:example");

      const moved = await service.update({
        id: "schedule-1",
        expectedVersion: 2,
        destinationConversationId: "!other-room:example"
      });
      expect(moved.schedule.destinationConversationId).toBe("!other-room:example");
      expect(moved.schedule.destinationThreadRootExternalEventId).toBeUndefined();
    });

    it("uses and validates agents from the active catalog", async () => {
      const schedules = new InMemoryScheduleRepository();
      const service = new ScheduleService({
        schedules,
        executions: new InMemoryExecutionRepository(),
        jobs: new InMemoryJobQueue(),
        clock: new MutableClock("2026-07-17T15:00:00.000Z"),
        ids: new SequentialIdGenerator(),
        agentCatalog: {
          defaultAgentId: () => "fixture-agent",
          get: (id) => (id === "fixture-agent" ? ({} as never) : undefined)
        }
      });

      await expect(
        service.create({
          ...SCHEDULE_SCOPE,
          name: "Fixture",
          instruction: "Run the fixture.",
          schedule: { type: "interval", seconds: 3600, timezone: "UTC" }
        })
      ).resolves.toMatchObject({ schedule: { agentId: "fixture-agent" } });
      await expect(
        service.create({
          ...SCHEDULE_SCOPE,
          name: "Unknown",
          instruction: "Do not run.",
          agentId: "missing-agent",
          schedule: { type: "interval", seconds: 3600, timezone: "UTC" }
        })
      ).rejects.toThrow("Unknown agent id in active catalog: missing-agent");
    });

    it("rejects stale updates and supports disable/enable/delete", async () => {
      const { service } = createHarness();
      await service.create({
        ...SCHEDULE_SCOPE,
        name: "Hourly",
        instruction: "Ping.",
        schedule: { type: "interval", seconds: 3600, timezone: "UTC" }
      });

      await expect(
        service.update({
          id: "schedule-1",
          expectedVersion: 99,
          name: "conflict"
        })
      ).rejects.toThrow(/version conflict/);

      await expect(service.disable("schedule-1", 1)).resolves.toMatchObject({
        enabled: false,
        version: 2
      });
      await expect(service.enable("schedule-1", 2)).resolves.toMatchObject({
        schedule: { enabled: true, version: 3, nextRunAt: "2026-07-17T16:00:00.000Z" }
      });
      await expect(service.delete("schedule-1", 3)).resolves.toMatchObject({
        enabled: false,
        version: 4
      });
      await expect(service.list()).resolves.toEqual([]);
    });
  });

  describe("manual execution", () => {
    it("run-now creates an idempotent manual execution without changing nextRunAt", async () => {
      const { service, jobs } = createHarness();
      await service.create({
        ...SCHEDULE_SCOPE,
        name: "Hourly",
        instruction: "Ping.",
        schedule: { type: "interval", seconds: 3600, timezone: "UTC" }
      });

      const before = await service.get("schedule-1");
      const execution = await service.runNow("schedule-1", "request-1");
      const after = await service.get("schedule-1");

      expect(execution).toMatchObject({
        id: "execution-schedule-1-manual-request-1",
        scheduleId: "schedule-1",
        status: "queued"
      });
      expect(after?.nextRunAt).toBe(before?.nextRunAt);
      expect(jobs.snapshot()).toHaveLength(1);
    });
  });

  describe("due execution", () => {
    it("claimDue creates exactly one scheduled execution and advances nextRunAt", async () => {
      const clock = new MutableClock("2026-07-17T15:00:00.000Z");
      const { service, jobs } = createHarness(clock);
      await service.create({
        ...SCHEDULE_SCOPE,
        name: "Hourly",
        instruction: "Ping.",
        schedule: { type: "interval", seconds: 3600, timezone: "UTC" }
      });
      clock.set("2026-07-17T16:00:00.000Z");

      const claimed = await service.claimDue(10);
      const schedule = await service.get("schedule-1");

      expect(claimed).toHaveLength(1);
      expect(claimed[0]).toMatchObject({
        id: "execution-schedule-1-2026-07-17T16:00:00.000Z",
        status: "queued"
      });
      expect(schedule?.lastRunAt).toBe("2026-07-17T16:00:00.000Z");
      expect(schedule?.nextRunAt).toBe("2026-07-17T17:00:00.000Z");
      expect(jobs.snapshot()).toHaveLength(1);

      await expect(service.claimDue(10)).resolves.toEqual([]);
    });

    it("records skipped execution when overlap policy is skip and an execution is active", async () => {
      const clock = new MutableClock("2026-07-17T15:00:00.000Z");
      const { service, executions, jobs } = createHarness(clock);
      await service.create({
        ...SCHEDULE_SCOPE,
        name: "Hourly",
        instruction: "Ping.",
        schedule: {
          type: "interval",
          seconds: 3600,
          timezone: "UTC"
        },
        overlapPolicy: "skip"
      });
      await executions.create({
        schemaVersion: 1,
        id: "active",
        scheduleId: "schedule-1",
        scheduledFor: "2026-07-17T15:30:00.000Z",
        status: "running",
        attempt: 1,
        createdAt: "2026-07-17T15:30:00.000Z"
      });
      clock.set("2026-07-17T16:00:00.000Z");

      await expect(service.claimDue(10)).resolves.toMatchObject([{ status: "skipped" }]);
      expect(jobs.snapshot()).toHaveLength(0);
    });

    it("keeps a claimed one-time schedule enabled until its queued run can execute", async () => {
      const clock = new MutableClock("2026-07-17T15:00:00.000Z");
      const { service, schedules, jobs } = createHarness(clock);
      const created = await service.create({
        ...SCHEDULE_SCOPE,
        name: "Say hi",
        instruction: "Say hi.",
        schedule: { type: "once", runAt: "2026-07-17T16:00:00.000Z" }
      });
      clock.set("2026-07-17T16:00:00.000Z");

      await expect(service.claimDue(10)).resolves.toMatchObject([
        { scheduleId: created.schedule.id, status: "queued" }
      ]);

      await expect(schedules.get(created.schedule.id)).resolves.toMatchObject({
        enabled: true,
        lastRunAt: "2026-07-17T16:00:00.000Z"
      });
      expect((await schedules.get(created.schedule.id))?.nextRunAt).toBeUndefined();
      expect(jobs.snapshot()).toHaveLength(1);
    });

    it("skips a missed occurrence without creating an execution when configured", async () => {
      const clock = new MutableClock("2026-07-17T15:00:00.000Z");
      const { service, jobs } = createHarness(clock);
      await service.create({
        ...SCHEDULE_SCOPE,
        name: "Daily review",
        instruction: "Review.",
        schedule: { type: "interval", seconds: 3600, timezone: "UTC" },
        missedRunPolicy: "skip"
      });
      clock.set("2026-07-17T18:00:00.000Z");

      await expect(service.claimDue(10)).resolves.toEqual([]);
      await expect(service.get("schedule-1")).resolves.toMatchObject({
        lastRunAt: "2026-07-17T16:00:00.000Z",
        nextRunAt: "2026-07-17T19:00:00.000Z"
      });
      expect(jobs.snapshot()).toHaveLength(0);
    });

    it("runs one missed occurrence and advances directly to a future occurrence", async () => {
      const clock = new MutableClock("2026-07-17T15:00:00.000Z");
      const { service, jobs } = createHarness(clock);
      await service.create({
        ...SCHEDULE_SCOPE,
        name: "Morning briefing",
        instruction: "Brief.",
        schedule: { type: "interval", seconds: 3600, timezone: "UTC" },
        missedRunPolicy: "run_once"
      });
      clock.set("2026-07-17T18:00:00.000Z");

      await expect(service.claimDue(10)).resolves.toMatchObject([
        { scheduledFor: "2026-07-17T16:00:00.000Z", status: "queued" }
      ]);
      await expect(service.get("schedule-1")).resolves.toMatchObject({
        nextRunAt: "2026-07-17T19:00:00.000Z"
      });
      expect(jobs.snapshot()).toHaveLength(1);
      await expect(service.claimDue(10)).resolves.toEqual([]);
    });

    it("delegates due claims to an atomic claim port when configured", async () => {
      const clock = new MutableClock("2026-07-17T16:00:00.000Z");
      const execution: ScheduledExecutionV1 = {
        schemaVersion: 1,
        id: "execution-atomic",
        scheduleId: "schedule-1",
        scheduledFor: "2026-07-17T16:00:00.000Z",
        status: "queued",
        attempt: 0,
        createdAt: "2026-07-17T16:00:00.000Z"
      };
      const claims = new RecordingScheduleClaimPort([execution]);
      const { service, schedules } = createHarness(clock, claims);
      await service.create({
        ...SCHEDULE_SCOPE,
        name: "Hourly",
        instruction: "Ping.",
        schedule: { type: "interval", seconds: 3600, timezone: "UTC" }
      });

      await expect(service.claimDue(3)).resolves.toEqual([execution]);

      expect(claims.inputs).toEqual([{ now: new Date("2026-07-17T16:00:00.000Z"), limit: 3 }]);
      expect(await schedules.get("schedule-1")).toMatchObject({ version: 1 });
    });
  });
});

function createHarness(
  clock: MutableClock = new MutableClock("2026-07-17T15:00:00.000Z"),
  scheduleClaims?: ScheduleClaimPort
) {
  const schedules = new InMemoryScheduleRepository();
  const executions = new InMemoryExecutionRepository();
  const jobs = new InMemoryJobQueue();
  const service = new ScheduleService({
    schedules,
    executions,
    jobs,
    ...(scheduleClaims ? { scheduleClaims } : {}),
    clock,
    ids: new SequentialIdGenerator()
  });
  return { service, schedules, executions, jobs };
}

class RecordingScheduleClaimPort implements ScheduleClaimPort {
  readonly inputs: Array<{ now: Date; limit: number }> = [];

  constructor(private readonly executions: ScheduledExecutionV1[]) {}

  async claimDue(input: { now: Date; limit: number }): Promise<ScheduledExecutionV1[]> {
    this.inputs.push(input);
    return this.executions;
  }
}

class MutableClock implements ClockPort {
  private current: Date;

  constructor(initial: string) {
    this.current = new Date(initial);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(timestamp: string): void {
    this.current = new Date(timestamp);
  }
}

class SequentialIdGenerator implements IdGeneratorPort {
  private next = 1;

  nextId(prefix: string): string {
    const id = `${prefix}-${this.next}`;
    this.next += 1;
    return id;
  }
}

class InMemoryScheduleRepository implements ScheduleRepositoryPort {
  private readonly schedules = new Map<string, ScheduledJobV1>();
  private readonly deleted = new Set<string>();

  async create(job: ScheduledJobV1): Promise<ScheduledJobV1> {
    this.schedules.set(job.id, job);
    return job;
  }

  async get(id: string): Promise<ScheduledJobV1 | undefined> {
    return this.schedules.get(id);
  }

  async list(): Promise<ScheduledJobV1[]> {
    return [...this.schedules.values()].filter((schedule) => !this.deleted.has(schedule.id));
  }

  async update(job: ScheduledJobV1, expectedVersion: number): Promise<ScheduledJobV1> {
    const existing = this.schedules.get(job.id);
    if (!existing) {
      throw new Error(`Unknown schedule: ${job.id}`);
    }
    if (existing.version !== expectedVersion) {
      throw new Error(`Schedule version conflict: ${job.id}`);
    }
    this.schedules.set(job.id, job);
    return job;
  }

  async delete(input: {
    id: string;
    now: Date;
    expectedVersion?: number;
  }): Promise<ScheduledJobV1> {
    const existing = this.schedules.get(input.id);
    if (!existing) {
      throw new Error(`Unknown schedule: ${input.id}`);
    }
    if (input.expectedVersion !== undefined && input.expectedVersion !== existing.version) {
      throw new Error(`Schedule version conflict: ${input.id}`);
    }
    const deleted: ScheduledJobV1 = {
      ...existing,
      enabled: false,
      version: existing.version + 1,
      updatedAt: input.now.toISOString()
    };
    this.schedules.set(input.id, deleted);
    this.deleted.add(input.id);
    return deleted;
  }

  async claimDue(input: { now: Date; limit: number }): Promise<ScheduledJobV1[]> {
    return [...this.schedules.values()]
      .filter(
        (schedule) =>
          !this.deleted.has(schedule.id) &&
          schedule.enabled &&
          Boolean(schedule.nextRunAt) &&
          new Date(schedule.nextRunAt!).getTime() <= input.now.getTime()
      )
      .sort((a, b) => a.nextRunAt!.localeCompare(b.nextRunAt!))
      .slice(0, input.limit);
  }

  async hardDeleteDisabledOlderThan(input: {
    cutoff: Date;
    workspaceId?: string;
  }): Promise<number> {
    const cutoff = input.cutoff.getTime();
    if (!input.workspaceId) throw new Error("workspaceId is required");
    const toRemove: string[] = [];
    for (const [id, schedule] of this.schedules) {
      if (
        !schedule.enabled &&
        !this.deleted.has(id) &&
        schedule.workspaceId === input.workspaceId &&
        new Date(schedule.updatedAt).getTime() < cutoff
      ) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      this.schedules.delete(id);
    }
    return toRemove.length;
  }
}

class InMemoryExecutionRepository implements ExecutionRepositoryPort {
  private readonly executions = new Map<string, ScheduledExecutionV1>();

  async create(
    execution: ScheduledExecutionV1
  ): Promise<
    | { execution: ScheduledExecutionV1; duplicate: false }
    | { execution: ScheduledExecutionV1; duplicate: true }
  > {
    const existing = this.executions.get(execution.id);
    if (existing) {
      return { execution: existing, duplicate: true };
    }
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
