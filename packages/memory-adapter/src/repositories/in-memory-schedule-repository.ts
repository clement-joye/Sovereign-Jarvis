import type { ScheduleRepositoryPort } from "@second-brain/application";
import type { ScheduledJobV1 } from "@second-brain/contracts";
import { requireWorkspaceId } from "@second-brain/domain";

export class InMemoryScheduleRepository implements ScheduleRepositoryPort {
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
    if (input.expectedVersion !== undefined && existing.version !== input.expectedVersion) {
      throw new Error(`Schedule version conflict: ${input.id}`);
    }
    const deletedSchedule: ScheduledJobV1 = {
      ...existing,
      enabled: false,
      version: existing.version + 1,
      updatedAt: input.now.toISOString()
    };
    this.schedules.set(input.id, deletedSchedule);
    this.deleted.add(input.id);
    return deletedSchedule;
  }

  async disableByWorkspace(input: { workspaceId: string; now: Date }): Promise<number> {
    let disabled = 0;
    for (const [id, schedule] of this.schedules) {
      if (schedule.workspaceId !== input.workspaceId || !schedule.enabled || this.deleted.has(id))
        continue;
      this.schedules.set(id, {
        ...schedule,
        enabled: false,
        nextRunAt: undefined,
        version: schedule.version + 1,
        updatedAt: input.now.toISOString()
      });
      disabled += 1;
    }
    return disabled;
  }

  async claimDue(input: { now: Date; limit: number }): Promise<ScheduledJobV1[]> {
    return [...this.schedules.values()]
      .filter(
        (schedule) =>
          schedule.enabled &&
          schedule.nextRunAt !== undefined &&
          new Date(schedule.nextRunAt).getTime() <= input.now.getTime()
      )
      .sort((a, b) => a.nextRunAt!.localeCompare(b.nextRunAt!))
      .slice(0, input.limit);
  }

  async hardDeleteDisabledOlderThan(input: {
    cutoff: Date;
    workspaceId?: string;
  }): Promise<number> {
    const cutoff = input.cutoff.getTime();
    const toRemove: string[] = [];
    for (const [id, schedule] of this.schedules) {
      if (
        !schedule.enabled &&
        !this.deleted.has(id) &&
        requireWorkspaceId(schedule.workspaceId, "Stored schedule") ===
          requireWorkspaceId(input.workspaceId, "Schedule cleanup") &&
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

  snapshot(): ScheduledJobV1[] {
    return [...this.schedules.values()];
  }
}
