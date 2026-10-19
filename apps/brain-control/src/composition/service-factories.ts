import {
  RetentionService,
  ScheduleService,
  SessionRoutingService,
  type AttachmentStorePort,
  type ConversationPreferencePort,
  type ExecutionRepositoryPort,
  type JobQueuePort,
  type OutboundDeliveryPort,
  type RetentionRepositoryPort,
  type ScheduleClaimPort,
  type ScheduleRepositoryPort,
  type SessionRepositoryPort
} from "@second-brain/application";
import { type AgentCatalog, type ClockPort, type IdGeneratorPort } from "@second-brain/domain";

export interface ServiceFactoryConfig {
  readonly sessionIdleContinuationMs: number;
  readonly sessionRetentionMs: number;
  readonly scheduleDisplayTimezone: string;
}

export interface ServiceFactoryDependencies {
  readonly sessions: SessionRepositoryPort;
  readonly preferences: ConversationPreferencePort | undefined;
  readonly schedules: ScheduleRepositoryPort | undefined;
  readonly executions: ExecutionRepositoryPort;
  readonly jobs: JobQueuePort;
  readonly scheduleClaims: ScheduleClaimPort | undefined;
  readonly outboundDelivery: OutboundDeliveryPort;
  readonly retentionRecords: RetentionRepositoryPort;
  readonly attachments: AttachmentStorePort;
  readonly clock: ClockPort;
  readonly ids: IdGeneratorPort;
  readonly agentCatalog: AgentCatalog;
  readonly config: ServiceFactoryConfig;
  // Pre-constructed session routing handlers (built by the composition
  // root alongside the services so the wiring lives outside
  // `SessionRoutingService` itself).
  readonly voicePreferences: ConstructorParameters<
    typeof SessionRoutingService
  >[0]["voicePreferences"];
  readonly scheduleCommands: ConstructorParameters<
    typeof SessionRoutingService
  >[0]["scheduleCommands"];
  readonly lifecycleCommands: ConstructorParameters<
    typeof SessionRoutingService
  >[0]["lifecycleCommands"];
  readonly overviewCommands: ConstructorParameters<
    typeof SessionRoutingService
  >[0]["overviewCommands"];
  readonly conversations: ConstructorParameters<typeof SessionRoutingService>[0]["conversations"];
  readonly approvalCommands?: ConstructorParameters<
    typeof SessionRoutingService
  >[0]["approvalCommands"];
}

/**
 * Constructs the Brain Control application services from a flat
 * dependency bundle. The handler injection for `SessionRoutingService`
 * is preserved so the composition root continues to own the wiring.
 */
export function createApplicationServices(deps: ServiceFactoryDependencies) {
  const sessionRouting = new SessionRoutingService({
    sessions: deps.sessions,
    ...(deps.preferences ? { preferences: deps.preferences } : {}),
    ...(deps.voicePreferences ? { voicePreferences: deps.voicePreferences } : {}),
    ...(deps.scheduleCommands ? { scheduleCommands: deps.scheduleCommands } : {}),
    ...(deps.lifecycleCommands ? { lifecycleCommands: deps.lifecycleCommands } : {}),
    ...(deps.overviewCommands ? { overviewCommands: deps.overviewCommands } : {}),
    ...(deps.conversations ? { conversations: deps.conversations } : {}),
    ...(deps.approvalCommands ? { approvalCommands: deps.approvalCommands } : {}),
    clock: deps.clock,
    ids: deps.ids,
    agentCatalog: deps.agentCatalog,
    config: {
      idleContinuationMs: deps.config.sessionIdleContinuationMs,
      retentionMs: deps.config.sessionRetentionMs,
      scheduleDisplayTimezone: deps.config.scheduleDisplayTimezone
    }
  });

  const scheduleService = new ScheduleService({
    schedules: deps.schedules as ScheduleRepositoryPort,
    executions: deps.executions,
    jobs: deps.jobs,
    ...(deps.scheduleClaims ? { scheduleClaims: deps.scheduleClaims } : {}),
    clock: deps.clock,
    ids: deps.ids,
    agentCatalog: deps.agentCatalog
  });

  const retentionService = new RetentionService({
    repository: deps.retentionRecords,
    attachments: deps.attachments,
    now: (): Date => deps.clock.now()
  });

  return {
    sessionRouting,
    scheduleService,
    retentionService,
    outboundDelivery: deps.outboundDelivery
  };
}
