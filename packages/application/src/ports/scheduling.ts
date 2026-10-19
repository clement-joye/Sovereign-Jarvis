import type { ScheduledExecutionV1, ScheduledJobV1 } from "@second-brain/contracts";
export interface ScheduleRepositoryPort {
  create(job: ScheduledJobV1): Promise<ScheduledJobV1>;
  get(id: string): Promise<ScheduledJobV1 | undefined>;
  list(): Promise<ScheduledJobV1[]>;
  update(job: ScheduledJobV1, expectedVersion: number): Promise<ScheduledJobV1>;
  delete(input: { id: string; now: Date; expectedVersion?: number }): Promise<ScheduledJobV1>;
  disableByWorkspace?(input: { workspaceId: string; now: Date }): Promise<number>;
  claimDue(input: { now: Date; limit: number }): Promise<ScheduledJobV1[]>;
  hardDeleteDisabledOlderThan(input: { cutoff: Date; workspaceId?: string }): Promise<number>;
}
export interface ExecutionRepositoryPort {
  create(
    execution: ScheduledExecutionV1
  ): Promise<
    | { execution: ScheduledExecutionV1; duplicate: false }
    | { execution: ScheduledExecutionV1; duplicate: true }
  >;
  get(id: string): Promise<ScheduledExecutionV1 | undefined>;
  listBySchedule(scheduleId: string): Promise<ScheduledExecutionV1[]>;
  findActiveBySchedule(scheduleId: string): Promise<ScheduledExecutionV1 | undefined>;
  update(execution: ScheduledExecutionV1): Promise<ScheduledExecutionV1>;
}
export interface ScheduleClaimPort {
  claimDue(input: { now: Date; limit: number }): Promise<ScheduledExecutionV1[]>;
}
