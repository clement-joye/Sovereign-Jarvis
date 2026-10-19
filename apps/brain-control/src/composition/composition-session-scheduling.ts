import { ScheduleAnchorBinder, ScheduleApprovalService } from "@second-brain/application";
import type {
  ActionProposalService,
  ApprovalCommandHandler,
  ApprovalExecutionRegistry,
  ReviewedActionOperationRegistry
} from "@second-brain/application";
import type { AgentCatalog, ClockPort, IdGeneratorPort } from "@second-brain/domain";
import { InMemoryAttachmentStore } from "@second-brain/memory-adapter";

import type { BrainControlRepositoryGraph } from "./composition-repositories.js";
import { createApplicationServices } from "./service-factories.js";
import { buildSessionHandlers } from "./session-handler-factory.js";

export interface SessionSchedulingCompositionOptions {
  repositories: BrainControlRepositoryGraph;
  clock: ClockPort;
  ids: IdGeneratorPort;
  agentCatalog: AgentCatalog;
  approvalCommands: ApprovalCommandHandler;
  actionProposalService: ActionProposalService;
  approvalExecutions: ApprovalExecutionRegistry;
  reviewedOperations: ReviewedActionOperationRegistry | undefined;
  config: {
    sessionIdleContinuationMs: number;
    sessionRetentionMs: number;
    scheduleDisplayTimezone: string;
  };
}

/** Composes interactive sessions, durable schedules, and retention policy. */
export function createSessionSchedulingComposition(options: SessionSchedulingCompositionOptions) {
  const { repositories, config } = options;
  const handlers = buildSessionHandlers({
    sessions: repositories.sessions,
    preferences: repositories.preferences,
    schedules: repositories.schedules,
    clock: options.clock,
    ids: options.ids,
    config
  });
  const { sessionRouting, scheduleService, retentionService } = createApplicationServices({
    sessions: repositories.sessions,
    preferences: repositories.preferences,
    schedules: repositories.schedules,
    executions: repositories.executions,
    jobs: repositories.jobs,
    scheduleClaims: repositories.scheduleClaims,
    retentionRecords: repositories.retentionRecords,
    attachments: new InMemoryAttachmentStore(),
    outboundDelivery: repositories.outboundDelivery,
    clock: options.clock,
    ids: options.ids,
    agentCatalog: options.agentCatalog,
    config,
    ...handlers,
    approvalCommands: options.approvalCommands
  });
  const scheduleApprovals = new ScheduleApprovalService(
    scheduleService,
    options.actionProposalService,
    options.reviewedOperations
  );
  registerScheduleApprovalExecutors(
    scheduleApprovals,
    options.approvalExecutions,
    options.reviewedOperations
  );
  handlers.scheduleCommands.setRunNow(async (scheduleId) => {
    await scheduleService.runNow(scheduleId, options.ids.nextId("manual"));
  });
  return {
    sessionRouting,
    scheduleService,
    retentionService,
    scheduleApprovals,
    scheduleAnchorBinder: new ScheduleAnchorBinder(
      repositories.sessions,
      repositories.executions,
      repositories.schedules
    )
  };
}

function registerScheduleApprovalExecutors(
  scheduleApprovals: ScheduleApprovalService,
  approvalExecutions: ApprovalExecutionRegistry,
  reviewedOperations: ReviewedActionOperationRegistry | undefined
): void {
  for (const operationId of [
    "schedule-create",
    "schedule-update",
    "schedule-delete",
    "schedule-run-now"
  ] as const) {
    approvalExecutions.register({
      pluginId: reviewedOperations?.require(operationId).pluginId ?? "schedule-control",
      operationId,
      execute: (proposal) => scheduleApprovals.executeApproved(proposal)
    });
  }
}
