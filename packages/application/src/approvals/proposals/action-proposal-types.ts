import type { ApprovalModeV1 } from "@second-brain/contracts";
import type { ClockPort, IdGeneratorPort } from "@second-brain/domain";
import type { SecurityEventEmitter } from "@second-brain/observability";

import type {
  ActionApprovalPolicyRepositoryPort,
  ActionProposalRepositoryPort
} from "../../ports.js";

export interface ActionProposalCreateOptions {
  /** Optional user/workspace policy; it can only strengthen the floor. */
  approvalModeOverride?: ApprovalModeV1;
}

export interface ActionProposalConsumeInput {
  proposalId: string;
  workspaceId: string;
  agentId: string;
  runId: string;
  pluginId: string;
  capabilityId: string;
  operationId: string;
  operationVersion: string;
  operationDigest: string;
  idempotencyKey: string;
}

export interface ActionProposalServiceDependencies {
  proposals: ActionProposalRepositoryPort;
  ids: IdGeneratorPort;
  clock: ClockPort;
  policies?: Pick<ActionApprovalPolicyRepositoryPort, "getMode">;
  securityEvents?: SecurityEventEmitter;
}
