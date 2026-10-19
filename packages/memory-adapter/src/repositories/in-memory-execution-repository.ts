import type { ExecutionRepositoryPort } from "@second-brain/application";
import type { ScheduledExecutionV1 } from "@second-brain/contracts";

export class InMemoryExecutionRepository implements ExecutionRepositoryPort {
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
    return [...this.executions.values()]
      .filter((execution) => execution.scheduleId === scheduleId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
    if (!this.executions.has(execution.id)) {
      throw new Error(`Unknown execution: ${execution.id}`);
    }
    this.executions.set(execution.id, execution);
    return execution;
  }

  snapshot(): ScheduledExecutionV1[] {
    return [...this.executions.values()];
  }
}
