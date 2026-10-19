import type {
  AgentIdV1,
  ScheduleDefinitionV1,
  ScheduledExecutionV1,
  ScheduledJobV1,
  SessionPolicyV1
} from "@second-brain/contracts";
import { previewSchedule, type OccurrencePreview } from "@second-brain/schedule-engine";
import type { AgentCatalog, ClockPort, IdGeneratorPort } from "@second-brain/domain";

import type {
  ExecutionRepositoryPort,
  JobQueuePort,
  ScheduleClaimPort,
  ScheduleRepositoryPort
} from "../../ports.js";
import {
  buildRunScheduleJob,
  buildScheduledExecution,
  claimDueSchedules,
  omitUndefinedNextRunAt
} from "../execution/schedule-claim-service.js";
import {
  buildCreatedSchedule,
  buildUpdatedSchedule,
  mergeScheduleUpdate,
  validateScheduleInput
} from "./schedule-mutation.js";

export {
  advanceScheduleAfterClaim,
  buildRunScheduleJob,
  buildScheduledExecution,
  claimDueSchedules,
  type ClaimDueSchedulesInput
} from "../execution/schedule-claim-service.js";

export interface CreateScheduleInput {
  workspaceId: string;
  destinationConversationId: string;
  destinationThreadRootExternalEventId?: string;
  agentId?: AgentIdV1;
  name: string;
  instruction: string;
  schedule: ScheduleDefinitionV1;
  enabled?: boolean;
  sessionPolicy?: SessionPolicyV1;
  notificationPolicy?: ScheduledJobV1["notificationPolicy"];
  overlapPolicy?: ScheduledJobV1["overlapPolicy"];
  missedRunPolicy?: ScheduledJobV1["missedRunPolicy"];
  timeoutSeconds?: number;
}

export interface UpdateScheduleInput extends Partial<CreateScheduleInput> {
  id: string;
  expectedVersion: number;
}

export interface ScheduleMutationResult {
  schedule: ScheduledJobV1;
  preview: OccurrencePreview;
}

export interface ScheduleServiceOptions {
  schedules: ScheduleRepositoryPort;
  executions: ExecutionRepositoryPort;
  jobs: JobQueuePort;
  scheduleClaims?: ScheduleClaimPort;
  clock: ClockPort;
  ids: IdGeneratorPort;
  defaultAgentId?: string;
  agentCatalog?: Pick<AgentCatalog, "get" | "defaultAgentId">;
}

export class ScheduleService {
  private readonly schedules: ScheduleRepositoryPort;
  private readonly executions: ExecutionRepositoryPort;
  private readonly jobs: JobQueuePort;
  private readonly scheduleClaims: ScheduleClaimPort | undefined;
  private readonly clock: ClockPort;
  private readonly ids: IdGeneratorPort;
  private readonly defaultAgentId: string;
  private readonly agentCatalog: Pick<AgentCatalog, "get"> | undefined;

  constructor(options: ScheduleServiceOptions) {
    this.schedules = options.schedules;
    this.executions = options.executions;
    this.jobs = options.jobs;
    this.scheduleClaims = options.scheduleClaims;
    this.clock = options.clock;
    this.ids = options.ids;
    this.defaultAgentId =
      options.agentCatalog?.defaultAgentId() ?? options.defaultAgentId ?? "brain";
    this.agentCatalog = options.agentCatalog;
  }

  async create(input: CreateScheduleInput): Promise<ScheduleMutationResult> {
    validateScheduleInput(input);
    this.requireActiveAgent(input.agentId ?? this.defaultAgentId);
    const now = this.clock.now();
    const preview = previewSchedule(input.schedule, { now, count: 3 });
    if ((input.enabled ?? true) && preview.occurrences.length === 0) {
      throw new Error("Schedule has no future occurrence.");
    }
    const schedule = buildCreatedSchedule({
      id: this.ids.nextId("schedule"),
      input,
      now,
      preview,
      defaultAgentId: this.defaultAgentId
    });
    return { schedule: await this.schedules.create(schedule), preview };
  }

  async update(input: UpdateScheduleInput): Promise<ScheduleMutationResult> {
    const existing = await this.requireSchedule(input.id);
    const merged = mergeScheduleUpdate(existing, input);
    validateScheduleInput(merged);
    this.requireActiveAgent(merged.agentId ?? this.defaultAgentId);

    const now = this.clock.now();
    const preview = previewSchedule(merged.schedule, { now, count: 3 });
    const schedule = buildUpdatedSchedule(existing, merged, preview, now);

    return {
      schedule: await this.schedules.update(
        omitUndefinedNextRunAt(schedule),
        input.expectedVersion
      ),
      preview
    };
  }

  private requireActiveAgent(agentId: string): void {
    if (this.agentCatalog && !this.agentCatalog.get(agentId)) {
      throw new Error(`Unknown agent id in active catalog: ${agentId}.`);
    }
  }

  async disable(id: string, expectedVersion: number): Promise<ScheduledJobV1> {
    const existing = await this.requireSchedule(id);
    return this.schedules.update(
      omitUndefinedNextRunAt({
        ...existing,
        enabled: false,
        nextRunAt: undefined,
        version: existing.version + 1,
        updatedAt: this.clock.now().toISOString()
      }),
      expectedVersion
    );
  }

  async enable(id: string, expectedVersion: number): Promise<ScheduleMutationResult> {
    const existing = await this.requireSchedule(id);
    const now = this.clock.now();
    const preview = previewSchedule(existing.schedule, { now, count: 3 });
    if (!preview.nextRunAt) {
      throw new Error("Schedule has no future occurrence.");
    }
    const updated = await this.schedules.update(
      {
        ...existing,
        enabled: true,
        nextRunAt: preview.nextRunAt,
        version: existing.version + 1,
        updatedAt: now.toISOString()
      },
      expectedVersion
    );
    return { schedule: updated, preview };
  }

  async delete(id: string, expectedVersion?: number): Promise<ScheduledJobV1> {
    return this.schedules.delete({
      id,
      now: this.clock.now(),
      ...(expectedVersion !== undefined ? { expectedVersion } : {})
    });
  }

  async runNow(scheduleId: string, requestId: string): Promise<ScheduledExecutionV1> {
    const schedule = await this.requireSchedule(scheduleId);
    const now = this.clock.now();
    const execution = buildScheduledExecution({
      scheduleId: schedule.id,
      scheduledFor: now.toISOString(),
      now,
      manualRequestId: requestId
    });
    const created = await this.executions.create(execution);
    await this.enqueueRunSchedule(schedule, created.execution);
    return created.execution;
  }

  async claimDue(limit: number): Promise<ScheduledExecutionV1[]> {
    const now = this.clock.now();
    if (this.scheduleClaims) {
      return this.scheduleClaims.claimDue({ now, limit });
    }

    return claimDueSchedules({
      schedules: this.schedules,
      executions: this.executions,
      jobs: this.jobs,
      now,
      limit,
      ids: this.ids
    });
  }

  async get(id: string): Promise<ScheduledJobV1 | undefined> {
    return this.schedules.get(id);
  }

  async list(): Promise<ScheduledJobV1[]> {
    return this.schedules.list();
  }

  async history(scheduleId: string): Promise<ScheduledExecutionV1[]> {
    return this.executions.listBySchedule(scheduleId);
  }

  private async requireSchedule(id: string): Promise<ScheduledJobV1> {
    const schedule = await this.schedules.get(id);
    if (!schedule) {
      throw new Error(`Unknown schedule: ${id}`);
    }
    return schedule;
  }

  private async enqueueRunSchedule(
    schedule: ScheduledJobV1,
    execution: ScheduledExecutionV1
  ): Promise<void> {
    await this.jobs.enqueue(
      buildRunScheduleJob({
        id: this.ids.nextId("job"),
        schedule,
        execution,
        now: this.clock.now()
      })
    );
  }
}
