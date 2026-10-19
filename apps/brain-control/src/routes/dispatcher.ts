import type { IncomingMessage, ServerResponse } from "node:http";

import {
  type ConversationPreferencePort,
  type ExecutionRepositoryPort,
  type OutboundDeliveryPort,
  type OutboundRepositoryPort,
  type OutboundJobCompletionPort,
  type RetentionService,
  type ScheduleAnchorBinder,
  type ScheduleService,
  type ScheduleApprovalService,
  type SessionRepositoryPort,
  type SessionRoutingService,
  type WorkspaceResolutionService,
  type WorkspaceInvitationService,
  type WorkspaceLifecycleRoomResolutionService,
  type WorkspaceRoomLifecycleService,
  type WorkspaceRoomRuntimeRecoveryService,
  type RoomLifecycleCommandSubmissionService,
  type RoomAgentCommandSubmissionService,
  type RoomPluginCommandSubmissionService,
  type WorkspacePluginBindingListingRepositoryPort,
  type ActionApprovalPolicyRepositoryPort,
  type AgentCollaborationRepositoryPort,
  type PlannerDelegationService,
  type AgentRunCancellationService,
  type EffectiveRunPolicyResolver,
  type BrokerOperationRegistry
} from "@second-brain/application";
import { type AgentCatalog, type IdGeneratorPort } from "@second-brain/domain";
import { pingPostgresPool } from "@second-brain/postgres-adapter";
import { aggregateHealthStatus, healthStatus } from "@second-brain/observability";
import { INTERNAL_API_VERSION } from "@second-brain/contracts";

import { type InboundAcceptancePort } from "./inbound-routes.js";
import { type InspectableJobQueue } from "./job-routes.js";
import { type InboundMessageRepositoryPort } from "@second-brain/application";
import type { RoomPluginCatalog } from "@second-brain/application";
import type { WorkspaceWriteLeaseRepositoryPort } from "@second-brain/application";
import type { RunAuthorizationService } from "../authorization/run-authorization.js";
import { createBrainControlRouteRegistry } from "./route-registry.js";
import type { ApprovalPromptPublisher } from "../approvals/approval-prompt-publisher.js";

type ReadJsonBodyFn = (request: IncomingMessage) => Promise<unknown>;
type WriteJsonBodyFn = (response: ServerResponse, statusCode: number, body: unknown) => void;

export interface BrainControlDispatcher {
  readonly serviceName: string;
  readonly version: string;
  readonly catalogDigest?: string;
  readonly policyDigest?: string;
  readonly agentCatalog: AgentCatalog;
  readonly postgresPool: Parameters<typeof pingPostgresPool>[0] | undefined;
  readonly inboundAcceptance: InboundAcceptancePort;
  readonly inboundMessages: InboundMessageRepositoryPort;
  readonly cancelPiRun?: (workspaceId: string, runId: string) => Promise<void>;
  readonly jobs: InspectableJobQueue;
  readonly completeWithOutbound: OutboundJobCompletionPort["createOutboundAndComplete"];
  readonly outbounds: OutboundRepositoryPort;
  readonly outboundDelivery: OutboundDeliveryPort;
  readonly scheduleAnchorBinder: ScheduleAnchorBinder;
  readonly scheduleService: ScheduleService;
  readonly scheduleApprovals?: ScheduleApprovalService;
  readonly sessions: SessionRepositoryPort;
  readonly retentionService: RetentionService;
  readonly executions: ExecutionRepositoryPort;
  readonly ids: IdGeneratorPort;
  readonly sessionRouting: SessionRoutingService;
  readonly preferences: ConversationPreferencePort;
  readonly workspaceResolution?: WorkspaceResolutionService;
  readonly workspaceLifecycleResolution?: WorkspaceLifecycleRoomResolutionService;
  readonly workspaceRoomLifecycle?: WorkspaceRoomLifecycleService;
  readonly workspaceRoomRuntimeRecovery?: WorkspaceRoomRuntimeRecoveryService;
  readonly workspaceInvitation?: WorkspaceInvitationService;
  readonly roomLifecycleCommands?: RoomLifecycleCommandSubmissionService;
  readonly roomAgentCommands?: RoomAgentCommandSubmissionService;
  readonly roomPluginCommands?: RoomPluginCommandSubmissionService;
  readonly readJson: ReadJsonBodyFn;
  readonly writeJson: WriteJsonBodyFn;
  readonly scheduleToken?: string;
  readonly brokerOperations?: BrokerOperationRegistry;
  readonly approvalPrompts?: ApprovalPromptPublisher;
  readonly pluginBindings?: WorkspacePluginBindingListingRepositoryPort;
  readonly actionApprovalPolicies?: ActionApprovalPolicyRepositoryPort;
  readonly pluginCatalog?: RoomPluginCatalog;
  readonly pluginAdminToken?: string;
  readonly collaboration?: AgentCollaborationRepositoryPort;
  readonly plannerDelegation?: PlannerDelegationService;
  readonly agentRunCancellation?: AgentRunCancellationService;
  readonly workspaceWriteLeases?: WorkspaceWriteLeaseRepositoryPort;
  readonly workerCollaborationToken?: string;
  readonly runAuthorizations?: RunAuthorizationService;
  readonly effectiveRunPolicies?: Pick<EffectiveRunPolicyResolver, "resolve" | "resolveIfActive">;
  readonly rootAdmission?: { limit: number; leaseMs: number; heartbeatMs: number };
}

/**
 * Single entry point for every HTTP request handled by Brain Control.
 * The dispatcher closes over the runtime services and routes the request
 * to the matching route module, returning a 404 when nothing matches.
 */
export async function dispatchBrainControlRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: BrainControlDispatcher
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://brain-control.local");

  if (method === "GET" && url.pathname === "/health") {
    await handleHealth(request, response, deps);
    return;
  }

  for (const route of createBrainControlRouteRegistry(deps)) {
    if (await route({ request, response, url })) {
      return;
    }
  }

  deps.writeJson(response, 404, { error: "not_found" });
}

async function handleHealth(
  _request: IncomingMessage,
  response: ServerResponse,
  deps: BrainControlDispatcher
): Promise<void> {
  const checkedAt = new Date().toISOString();
  const dependencies: {
    name: string;
    status: "ready" | "unavailable";
    failureKind?: "dependency_unavailable";
  }[] = [];
  if (deps.postgresPool) {
    const ok = await pingPostgresPool(deps.postgresPool);
    dependencies.push(
      ok
        ? { name: "postgres", status: "ready" }
        : {
            name: "postgres",
            status: "unavailable",
            failureKind: "dependency_unavailable"
          }
    );
  }
  const envelope =
    dependencies.length > 0
      ? aggregateHealthStatus({
          service: deps.serviceName,
          checkedAt,
          version: deps.version,
          apiVersion: INTERNAL_API_VERSION,
          ...(deps.catalogDigest ? { catalogDigest: deps.catalogDigest } : {}),
          ...(deps.policyDigest ? { policyDigest: deps.policyDigest } : {}),
          dependencies
        })
      : healthStatus({
          service: deps.serviceName,
          status: "live",
          checkedAt,
          version: deps.version,
          apiVersion: INTERNAL_API_VERSION,
          ...(deps.catalogDigest ? { catalogDigest: deps.catalogDigest } : {}),
          ...(deps.policyDigest ? { policyDigest: deps.policyDigest } : {}),
          dependencies: []
        });
  const unavailable = envelope.status === "unavailable" || envelope.status === "degraded";
  deps.writeJson(response, unavailable ? 503 : 200, envelope);
}
