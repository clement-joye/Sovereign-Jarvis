import type {
  ActionApprovalPolicyRepositoryPort,
  ActionProposalRepositoryPort,
  AgentCollaborationRepositoryPort,
  ConversationPreferencePort,
  ExecutionRepositoryPort,
  InboundMessageRepositoryPort,
  OutboundDeliveryPort,
  OutboundRepositoryPort,
  RetentionRepositoryPort,
  ScheduleClaimPort,
  ScheduleRepositoryPort,
  SessionRepositoryPort,
  WorkspacePluginBindingListingRepositoryPort,
  WorkspaceRepositoryPort,
  WorkspaceWriteLeaseRepositoryPort
} from "@second-brain/application";
import type { IdGeneratorPort } from "@second-brain/domain";
import type { PostgresQueryable } from "@second-brain/postgres-adapter";

import type { InboundAcceptancePort } from "../routes/inbound-routes.js";
import type { InspectableJobQueue } from "../routes/job-routes.js";
import {
  createActionApprovalPolicies,
  createActionProposals,
  createCollaboration,
  createExecutions,
  createInboundAcceptance,
  createInboundMessages,
  createJobQueue,
  createOutboundDelivery,
  createOutbounds,
  createPreferences,
  createRetentionRepository,
  createScheduleClaims,
  createSchedules,
  createSessions,
  createWorkspacePluginBindings,
  createWorkspaceWriteLeases,
  createWorkspaces
} from "./repository-factories.js";

export interface BrainControlRepositoryGraph {
  jobs: InspectableJobQueue;
  collaboration: AgentCollaborationRepositoryPort;
  workspaceWriteLeases: WorkspaceWriteLeaseRepositoryPort;
  inboundMessages: InboundMessageRepositoryPort;
  sessions: SessionRepositoryPort;
  workspaces: WorkspaceRepositoryPort;
  schedules: ScheduleRepositoryPort;
  pluginBindings: WorkspacePluginBindingListingRepositoryPort;
  actionApprovalPolicies: ActionApprovalPolicyRepositoryPort;
  actionProposals: ActionProposalRepositoryPort;
  preferences: ConversationPreferencePort;
  executions: ExecutionRepositoryPort;
  scheduleClaims: ScheduleClaimPort | undefined;
  outbounds: OutboundRepositoryPort;
  outboundDelivery: OutboundDeliveryPort;
  retentionRecords: RetentionRepositoryPort;
  inboundAcceptance: InboundAcceptancePort;
}

export interface BrainControlRepositoryGraphOptions {
  postgresPool: PostgresQueryable | undefined;
  ids: IdGeneratorPort;
  retentionMs: number;
  maxRetentionMs: number;
}

/** Builds the complete persistence graph for the selected storage backend. */
export function createBrainControlRepositoryGraph(
  options: BrainControlRepositoryGraphOptions
): BrainControlRepositoryGraph {
  const { postgresPool, ids } = options;
  const jobs = createJobQueue(postgresPool);
  const inboundMessages = createInboundMessages(postgresPool);
  const outbounds = createOutbounds(postgresPool);
  return {
    jobs,
    collaboration: createCollaboration(postgresPool),
    workspaceWriteLeases: createWorkspaceWriteLeases(postgresPool),
    inboundMessages,
    sessions: createSessions(postgresPool),
    workspaces: createWorkspaces(postgresPool),
    schedules: createSchedules(postgresPool),
    pluginBindings: createWorkspacePluginBindings(postgresPool),
    actionApprovalPolicies: createActionApprovalPolicies(postgresPool),
    actionProposals: createActionProposals(postgresPool),
    preferences: createPreferences(postgresPool),
    executions: createExecutions(postgresPool),
    scheduleClaims: createScheduleClaims(postgresPool, ids),
    outbounds,
    outboundDelivery: createOutboundDelivery(postgresPool, outbounds),
    retentionRecords: createRetentionRepository(postgresPool, {
      retentionMs: options.retentionMs,
      maxRetentionMs: options.maxRetentionMs
    }),
    inboundAcceptance: createInboundAcceptance(postgresPool, ids, inboundMessages, jobs)
  };
}
