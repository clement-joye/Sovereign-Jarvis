import {
  ScheduleCreateRequestV1Schema,
  ScheduleDeleteRequestV1Schema,
  ScheduleRunRequestV1Schema,
  ScheduleUpdateRequestV1Schema,
  type ActionProposalPendingV1,
  type ActionProposalV1,
  type ScheduleCreateRequestV1,
  type ScheduleUpdateRequestV1
} from "@second-brain/contracts";
import type { RoomAgentId } from "@second-brain/domain";

import { actionProposalOperationDigest } from "../../approvals/proposals/action-proposal-canonicalization.js";
import type { ActionProposalService } from "../../approvals/commands/approval-service.js";
import type {
  CreateScheduleInput,
  ScheduleService,
  UpdateScheduleInput
} from "../commands/schedules.js";
import type {
  ReviewedActionOperation,
  ReviewedActionOperationRegistry
} from "../../approvals/registries/reviewed-action-operation-registry.js";

const PLUGIN_ID = "schedule-control";
const CAPABILITY_ID = "schedule-mutation";
const OPERATION_VERSION = "1.0.0";

export type ScheduleMutationOperation =
  | "schedule-create"
  | "schedule-update"
  | "schedule-delete"
  | "schedule-run-now";

/** Durable owner-approval boundary for schedule mutations requested by an agent run. */
export class ScheduleApprovalService {
  constructor(
    private readonly schedules: ScheduleService,
    private readonly proposals: ActionProposalService,
    private readonly operations?: Pick<ReviewedActionOperationRegistry, "require">
  ) {}

  async propose(input: {
    workspaceId: string;
    agentId: RoomAgentId;
    runId: string;
    idempotencyKey: string;
    expiresAt: string;
    operation: ScheduleMutationOperation;
    parameters: Record<string, unknown>;
  }): Promise<ActionProposalPendingV1> {
    const normalized = await this.validate(input.workspaceId, input.operation, input.parameters);
    const declaration = this.operationDeclaration(input.operation);
    const { operation } = declaration;
    const operationDigest = actionProposalOperationDigest({
      pluginId: declaration.pluginId,
      operation,
      parameters: normalized.parameters
    });
    const proposal = await this.proposals.createProposal({
      schemaVersion: 1,
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      runId: input.runId,
      pluginId: declaration.pluginId,
      operation,
      operationDigest,
      summary: normalized.summary,
      parameters: normalized.parameters,
      approvalMode: operation.approvalPolicy.minimumMode,
      idempotencyKey: input.idempotencyKey,
      expiresAt: input.expiresAt
    });
    return { schemaVersion: 1, outcome: "pending", proposal };
  }

  /** Provider callback registered with `ApprovalExecutionRegistry`. */
  async executeApproved(proposal: ActionProposalV1): Promise<unknown> {
    const declaration = this.operationDeclaration(
      proposal.operationId as ScheduleMutationOperation
    );
    if (
      proposal.status !== "consumed" ||
      proposal.pluginId !== declaration.pluginId ||
      proposal.capabilityId !== declaration.operation.capabilityId
    ) {
      throw new Error("Schedule mutation requires a consumed schedule action proposal.");
    }
    const operation = proposal.operationId as ScheduleMutationOperation;
    const normalized = await this.validate(proposal.workspaceId, operation, proposal.parameters);
    switch (operation) {
      case "schedule-create":
        return this.schedules.create(
          deserializeScheduleCreate(
            ScheduleCreateRequestV1Schema.parse(normalized.parameters.request),
            proposal.workspaceId
          )
        );
      case "schedule-update": {
        const request = ScheduleUpdateRequestV1Schema.parse(normalized.parameters.request);
        return this.schedules.update(
          deserializeScheduleUpdate(normalized.parameters.id as string, request)
        );
      }
      case "schedule-delete": {
        const request = ScheduleDeleteRequestV1Schema.parse(normalized.parameters.request);
        return this.schedules.delete(normalized.parameters.id as string, request.expectedVersion);
      }
      case "schedule-run-now": {
        const request = ScheduleRunRequestV1Schema.parse(normalized.parameters.request);
        return this.schedules.runNow(normalized.parameters.id as string, request.requestId!);
      }
    }
  }

  private operationDeclaration(operation: ScheduleMutationOperation): ReviewedActionOperation {
    return (
      this.operations?.require(operation) ?? {
        pluginId: PLUGIN_ID,
        operation: {
          capabilityId: CAPABILITY_ID,
          operationId: operation,
          operationVersion: OPERATION_VERSION,
          approvalPolicy: { minimumMode: "owner", userMayStrengthen: true }
        }
      }
    );
  }

  private async validate(
    workspaceId: string,
    operation: ScheduleMutationOperation,
    parameters: Record<string, unknown>
  ): Promise<{ parameters: Record<string, unknown>; summary: string }> {
    if (operation === "schedule-create") {
      const request = ScheduleCreateRequestV1Schema.parse(parameters.request);
      if (request.workspaceId !== undefined && request.workspaceId !== workspaceId) {
        throw new Error("Schedule workspace does not match the authorized workspace.");
      }
      requireDestinationConversationId(request.destinationConversationId);
      const normalized = { ...request };
      delete normalized.workspaceId;
      return {
        parameters: { request: normalized },
        summary: `Create schedule ${request.name}`
      };
    }

    const id = parameters.id;
    if (typeof id !== "string" || !id) throw new Error("Schedule id is invalid.");
    const existing = await this.schedules.get(id);
    if (!existing || existing.workspaceId !== workspaceId) {
      throw new Error("Schedule was not found in the authorized workspace.");
    }
    if (operation === "schedule-update") {
      const request = ScheduleUpdateRequestV1Schema.parse(parameters.request);
      if (request.workspaceId !== undefined && request.workspaceId !== workspaceId) {
        throw new Error("Schedule workspace does not match the authorized workspace.");
      }
      const normalized = { ...request };
      delete normalized.workspaceId;
      return {
        parameters: { id, request: normalized },
        summary: `Update schedule ${existing.name}`
      };
    }
    if (operation === "schedule-delete") {
      const request = ScheduleDeleteRequestV1Schema.parse(parameters.request);
      return {
        parameters: { id, request },
        summary: `Delete schedule ${existing.name}`
      };
    }
    if (operation === "schedule-run-now") {
      const request = ScheduleRunRequestV1Schema.parse(parameters.request);
      if (!request.requestId) throw new Error("Approved schedule run requires a request id.");
      return {
        parameters: { id, request },
        summary: `Run schedule ${existing.name} now`
      };
    }
    throw new Error("Unknown schedule mutation operation.");
  }
}

function deserializeScheduleCreate(
  input: ScheduleCreateRequestV1,
  workspaceId: string
): CreateScheduleInput {
  return {
    workspaceId,
    destinationConversationId: requireDestinationConversationId(input.destinationConversationId),
    ...(input.destinationThreadRootExternalEventId
      ? { destinationThreadRootExternalEventId: input.destinationThreadRootExternalEventId }
      : {}),
    ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
    name: input.name,
    instruction: input.instruction,
    schedule: input.schedule,
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.sessionPolicy !== undefined ? { sessionPolicy: input.sessionPolicy } : {}),
    ...(input.notificationPolicy !== undefined
      ? { notificationPolicy: input.notificationPolicy }
      : {}),
    ...(input.overlapPolicy !== undefined ? { overlapPolicy: input.overlapPolicy } : {}),
    ...(input.missedRunPolicy !== undefined ? { missedRunPolicy: input.missedRunPolicy } : {}),
    ...(input.timeoutSeconds !== undefined ? { timeoutSeconds: input.timeoutSeconds } : {})
  };
}

function requireDestinationConversationId(value: string | undefined): string {
  if (!value) throw new Error("Schedule creation requires a destination conversation.");
  return value;
}

function deserializeScheduleUpdate(
  id: string,
  input: ScheduleUpdateRequestV1
): UpdateScheduleInput {
  return {
    id,
    expectedVersion: input.expectedVersion,
    ...(input.destinationConversationId !== undefined
      ? { destinationConversationId: input.destinationConversationId }
      : {}),
    ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.instruction !== undefined ? { instruction: input.instruction } : {}),
    ...(input.schedule !== undefined ? { schedule: input.schedule } : {}),
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.sessionPolicy !== undefined ? { sessionPolicy: input.sessionPolicy } : {}),
    ...(input.notificationPolicy !== undefined
      ? { notificationPolicy: input.notificationPolicy }
      : {}),
    ...(input.overlapPolicy !== undefined ? { overlapPolicy: input.overlapPolicy } : {}),
    ...(input.missedRunPolicy !== undefined ? { missedRunPolicy: input.missedRunPolicy } : {}),
    ...(input.timeoutSeconds !== undefined ? { timeoutSeconds: input.timeoutSeconds } : {})
  };
}
