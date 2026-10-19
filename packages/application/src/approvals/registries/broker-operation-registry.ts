import type {
  ActionProposalConsumedV1,
  ActionProposalPendingV1,
  ActionProposalV1,
  CompiledBrokerCapabilityV2,
  PlatformCatalogV2
} from "@second-brain/contracts";

import type { ApprovalExecutionRegistry } from "./approval-execution-registry.js";

export interface BrokerOperationRequest {
  workspaceId: string;
  agentId: string;
  runId: string;
  pluginId: string;
  operationId: string;
  idempotencyKey: string;
  expiresAt: string;
  parameters: Record<string, unknown>;
}

export interface BrokerOperationHandler {
  readonly implementationId: string;
  requestOperation(
    input: BrokerOperationRequest
  ): Promise<ActionProposalPendingV1 | ActionProposalConsumedV1>;
  executeApproved(proposal: ActionProposalV1): Promise<unknown>;
}

export interface ResolvedBrokerOperation {
  capability: CompiledBrokerCapabilityV2;
  operation: CompiledBrokerCapabilityV2["operations"][number];
  handler: BrokerOperationHandler;
}

/**
 * Immutable runtime registry for privileged plugin providers. The compiled
 * catalog owns operation/tool policy; handlers contribute implementation only.
 */
export class BrokerOperationRegistry {
  private readonly handlers: ReadonlyMap<string, BrokerOperationHandler>;
  private readonly operations: ReadonlyMap<string, ResolvedBrokerOperation>;

  constructor(
    catalog: Readonly<Pick<PlatformCatalogV2, "capabilities">>,
    handlers: readonly BrokerOperationHandler[]
  ) {
    const handlerEntries = handlers.map((handler) => [handler.implementationId, handler] as const);
    if (new Set(handlerEntries.map(([id]) => id)).size !== handlerEntries.length) {
      throw new Error("Duplicate broker operation handler implementation ID.");
    }
    this.handlers = new Map(handlerEntries);

    const entries: Array<readonly [string, ResolvedBrokerOperation]> = [];
    for (const capability of catalog.capabilities) {
      if (capability.providerKind !== "broker") continue;
      const handler = this.handlers.get(capability.implementationId);
      if (!handler) continue;
      for (const operation of capability.operations) {
        entries.push([
          operationKey(capability.pluginId, operation.id),
          { capability, operation, handler }
        ]);
      }
    }
    if (new Set(entries.map(([key]) => key)).size !== entries.length) {
      throw new Error("Compiled catalog contains duplicate plugin broker operations.");
    }
    for (const implementationId of this.handlers.keys()) {
      if (!entries.some(([, entry]) => entry.handler.implementationId === implementationId)) {
        throw new Error(`Broker handler is not declared by the catalog: ${implementationId}.`);
      }
    }
    this.operations = new Map(entries);
  }

  resolve(pluginId: string, operationId: string): ResolvedBrokerOperation {
    const resolved = this.operations.get(operationKey(pluginId, operationId));
    if (!resolved) throw new Error(`Broker operation is unavailable: ${pluginId}/${operationId}.`);
    return resolved;
  }

  async request(
    input: BrokerOperationRequest
  ): Promise<ActionProposalPendingV1 | ActionProposalConsumedV1> {
    return this.resolve(input.pluginId, input.operationId).handler.requestOperation(input);
  }

  registerApprovalExecutors(registry: ApprovalExecutionRegistry): void {
    for (const [key, resolved] of this.operations) {
      const separator = key.indexOf(":");
      registry.register({
        pluginId: key.slice(0, separator),
        operationId: key.slice(separator + 1),
        execute: (proposal) => resolved.handler.executeApproved(proposal)
      });
    }
  }
}

function operationKey(pluginId: string, operationId: string): string {
  return `${pluginId}:${operationId}`;
}
