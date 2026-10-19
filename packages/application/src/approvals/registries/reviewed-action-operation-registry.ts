import type {
  ActionOperationV1,
  CompiledCapabilityProviderV2,
  PlatformCatalogV2
} from "@second-brain/contracts";

export interface ReviewedOperationCatalog {
  readonly catalog: Readonly<Pick<PlatformCatalogV2, "capabilities">>;
}

export interface ReviewedActionOperation {
  pluginId: string;
  operation: ActionOperationV1;
}

/** Projects compiled broker declarations into the generic approval contract. */
export class ReviewedActionOperationRegistry {
  private readonly operations: ReadonlyMap<string, ReviewedActionOperation>;

  constructor(catalog: ReviewedOperationCatalog) {
    const entries = catalog.catalog.capabilities.flatMap((capability) =>
      capability.providerKind === "broker" ? operationEntries(capability) : []
    );
    if (new Set(entries.map(([id]) => id)).size !== entries.length) {
      throw new Error("Compiled catalog contains duplicate reviewed operation IDs.");
    }
    this.operations = new Map(entries);
  }

  require(operationId: string): ReviewedActionOperation {
    const declaration = this.operations.get(operationId);
    if (!declaration) throw new Error(`Unknown reviewed action operation: ${operationId}.`);
    return declaration;
  }
}

function operationEntries(
  capability: Extract<CompiledCapabilityProviderV2, { providerKind: "broker" }>
): Array<readonly [string, ReviewedActionOperation]> {
  return capability.operations.map((operation) => [
    operation.id,
    {
      pluginId: capability.pluginId,
      operation: {
        capabilityId: capability.capabilityId,
        operationId: operation.id,
        // Action proposal replay compatibility is currently contract-v1. The
        // immutable catalog definition digest provides release provenance.
        operationVersion: "1.0.0",
        approvalPolicy: {
          minimumMode: operation.approvalPolicy,
          userMayStrengthen: true
        }
      }
    }
  ]);
}
