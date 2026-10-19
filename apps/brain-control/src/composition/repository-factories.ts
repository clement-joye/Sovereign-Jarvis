import {
  InboundAcceptanceService,
  type ActionApprovalPolicyRepositoryPort,
  type ActionProposalRepositoryPort,
  type AgentCollaborationRepositoryPort,
  type ConversationPreferencePort,
  type ExecutionRepositoryPort,
  type InboundMessageRepositoryPort,
  type JobQueuePort,
  type OutboundDeliveryPort,
  type OutboundRepositoryPort,
  type RetentionRepositoryPort,
  type ScheduleClaimPort,
  type ScheduleRepositoryPort,
  type SessionRepositoryPort,
  type WorkspaceRepositoryPort,
  type WorkspacePluginBindingListingRepositoryPort,
  type WorkspaceWriteLeaseRepositoryPort
} from "@second-brain/application";
import { type IdGeneratorPort } from "@second-brain/domain";
import {
  PostgresConversationPreferenceRepository,
  PostgresActionApprovalPolicyRepository,
  PostgresActionProposalRepository,
  PostgresAgentCollaborationRepository,
  PostgresExecutionRepository,
  PostgresInboundAcceptanceService,
  PostgresInboundMessageRepository,
  PostgresJobQueue,
  PostgresOutboundDeliveryRepository,
  PostgresOutboundRepository,
  PostgresRetentionRepository,
  PostgresScheduleClaimService,
  PostgresScheduleRepository,
  PostgresSessionRepository,
  PostgresWorkspaceRepository,
  PostgresWorkspacePluginBindingRepository,
  PostgresWorkspaceWriteLeaseRepository
} from "@second-brain/postgres-adapter";
import type { WorkspaceWriteLeaseV1 } from "@second-brain/contracts";
import {
  InMemoryConversationPreferenceRepository,
  InMemoryActionApprovalPolicyRepository,
  InMemoryActionProposalRepository,
  InMemoryAgentCollaborationRepository,
  InMemoryExecutionRepository,
  InMemoryInboundMessageRepository,
  InMemoryJobQueue,
  InMemoryOutboundDeliveryRepository,
  InMemoryOutboundRepository,
  InMemoryRetentionRepository,
  InMemoryScheduleRepository,
  InMemorySessionRepository,
  InMemoryWorkspaceRepository,
  InMemoryWorkspacePluginBindingRepository
} from "@second-brain/memory-adapter";

import type { InboundAcceptancePort } from "../routes/inbound-routes.js";
import type { InspectableJobQueue } from "../routes/job-routes.js";

/**
 * `postgresPool` is typed structurally so this app does not need to depend
 * on the `pg` package. The actual `pg.Pool` instance is constructed by
 * `createPostgresPool` in `@second-brain/postgres-adapter` and is bridge-
 * cast at the postgres-adapter boundary via the `toPool` helper below.
 */
export type PostgresPool = {
  query?: (...args: never[]) => Promise<unknown>;
  connect?: () => Promise<unknown>;
};

const toPool = (value: PostgresPool | undefined) => value as never;

/**
 * Each factory returns a Postgres-backed implementation when a pool is
 * available, otherwise an in-memory implementation. The factories that
 * depend on other repositories receive them as arguments so the wiring
 * stays explicit.
 */
export function createJobQueue(postgresPool: PostgresPool | undefined): InspectableJobQueue {
  return postgresPool ? new PostgresJobQueue({ db: toPool(postgresPool) }) : new InMemoryJobQueue();
}

export function createCollaboration(
  postgresPool: PostgresPool | undefined
): AgentCollaborationRepositoryPort {
  return postgresPool
    ? new PostgresAgentCollaborationRepository(toPool(postgresPool))
    : new InMemoryAgentCollaborationRepository();
}

export function createActionProposals(
  postgresPool: PostgresPool | undefined
): ActionProposalRepositoryPort {
  return postgresPool
    ? new PostgresActionProposalRepository(toPool(postgresPool))
    : new InMemoryActionProposalRepository();
}

export function createWorkspaceWriteLeases(
  postgresPool: PostgresPool | undefined
): WorkspaceWriteLeaseRepositoryPort {
  return postgresPool
    ? new PostgresWorkspaceWriteLeaseRepository(toPool(postgresPool))
    : new InMemoryWorkspaceWriteLeases();
}

class InMemoryWorkspaceWriteLeases implements WorkspaceWriteLeaseRepositoryPort {
  private leases = new Map<string, WorkspaceWriteLeaseV1>();

  async acquire(
    input: WorkspaceWriteLeaseV1,
    now: Date
  ): Promise<WorkspaceWriteLeaseV1 | undefined> {
    const current = this.leases.get(input.workspaceId);
    if (current && current.expiresAt > now.toISOString() && current.ownerRunId !== input.ownerRunId)
      return undefined;
    this.leases.set(input.workspaceId, input);
    return input;
  }
  async renew(input: WorkspaceWriteLeaseV1, now: Date): Promise<WorkspaceWriteLeaseV1 | undefined> {
    const current = this.leases.get(input.workspaceId);
    if (
      !current ||
      current.ownerRunId !== input.ownerRunId ||
      current.expiresAt <= now.toISOString()
    )
      return undefined;
    this.leases.set(input.workspaceId, input);
    return input;
  }
  async release(input: { workspaceId: string; ownerRunId: string }): Promise<boolean> {
    const current = this.leases.get(input.workspaceId);
    if (!current || current.ownerRunId !== input.ownerRunId) return false;
    this.leases.delete(input.workspaceId);
    return true;
  }
  async get(workspaceId: string): Promise<WorkspaceWriteLeaseV1 | undefined> {
    return this.leases.get(workspaceId);
  }
}

export function createInboundMessages(
  postgresPool: PostgresPool | undefined
): InboundMessageRepositoryPort {
  return postgresPool
    ? new PostgresInboundMessageRepository({ db: toPool(postgresPool) })
    : new InMemoryInboundMessageRepository();
}

export function createSessions(postgresPool: PostgresPool | undefined): SessionRepositoryPort {
  return postgresPool
    ? new PostgresSessionRepository({ db: toPool(postgresPool) })
    : new InMemorySessionRepository();
}

export function createWorkspaces(postgresPool: PostgresPool | undefined): WorkspaceRepositoryPort {
  return postgresPool
    ? new PostgresWorkspaceRepository(toPool(postgresPool))
    : new InMemoryWorkspaceRepository();
}

export function createWorkspacePluginBindings(
  postgresPool: PostgresPool | undefined
): WorkspacePluginBindingListingRepositoryPort {
  return postgresPool
    ? new PostgresWorkspacePluginBindingRepository(toPool(postgresPool))
    : new InMemoryWorkspacePluginBindingRepository();
}

export function createActionApprovalPolicies(
  postgresPool: PostgresPool | undefined
): ActionApprovalPolicyRepositoryPort {
  return postgresPool
    ? new PostgresActionApprovalPolicyRepository(toPool(postgresPool))
    : new InMemoryActionApprovalPolicyRepository();
}

export function createPreferences(
  postgresPool: PostgresPool | undefined
): ConversationPreferencePort {
  return postgresPool
    ? new PostgresConversationPreferenceRepository(toPool(postgresPool))
    : new InMemoryConversationPreferenceRepository();
}

export function createSchedules(postgresPool: PostgresPool | undefined): ScheduleRepositoryPort {
  return postgresPool
    ? new PostgresScheduleRepository({ db: toPool(postgresPool) })
    : new InMemoryScheduleRepository();
}

export function createExecutions(postgresPool: PostgresPool | undefined): ExecutionRepositoryPort {
  return postgresPool
    ? new PostgresExecutionRepository({ db: toPool(postgresPool) })
    : new InMemoryExecutionRepository();
}

export function createScheduleClaims(
  postgresPool: PostgresPool | undefined,
  ids: IdGeneratorPort
): ScheduleClaimPort | undefined {
  return postgresPool
    ? new PostgresScheduleClaimService({ db: toPool(postgresPool), ids })
    : undefined;
}

export function createOutbounds(
  postgresPool: PostgresPool | undefined
): OutboundRepositoryPort | InMemoryOutboundRepository {
  return postgresPool
    ? new PostgresOutboundRepository({ db: toPool(postgresPool) })
    : new InMemoryOutboundRepository();
}

export function createOutboundDelivery(
  postgresPool: PostgresPool | undefined,
  outbounds: OutboundRepositoryPort | InMemoryOutboundRepository
): OutboundDeliveryPort {
  if (postgresPool) {
    return new PostgresOutboundDeliveryRepository({ db: toPool(postgresPool) });
  }
  if (!(outbounds instanceof InMemoryOutboundRepository)) {
    throw new Error("In-memory outbound delivery requires the in-memory outbound repository.");
  }
  return new InMemoryOutboundDeliveryRepository(outbounds);
}

export interface RetentionRepositoryFactoryOptions {
  readonly retentionMs: number;
  readonly maxRetentionMs: number;
}

export function createRetentionRepository(
  postgresPool: PostgresPool | undefined,
  options: RetentionRepositoryFactoryOptions
): RetentionRepositoryPort {
  return postgresPool
    ? new PostgresRetentionRepository({
        db: toPool(postgresPool),
        retentionMs: options.retentionMs,
        maxRetentionMs: options.maxRetentionMs
      })
    : new InMemoryRetentionRepository();
}

export function createInboundAcceptance(
  postgresPool: PostgresPool | undefined,
  ids: IdGeneratorPort,
  inboundMessages: InboundMessageRepositoryPort,
  jobs: JobQueuePort
): InboundAcceptancePort {
  if (postgresPool) {
    return new PostgresInboundAcceptanceService({
      db: toPool(postgresPool),
      ids,
      now: () => new Date()
    });
  }
  return new InboundAcceptanceService({ inboundMessages, jobs, ids, now: () => new Date() });
}
