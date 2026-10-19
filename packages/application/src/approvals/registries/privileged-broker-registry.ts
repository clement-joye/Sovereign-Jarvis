export interface PrivilegedBrokerRequest {
  workspaceId: string;
  operationId: string;
  parameters: Record<string, unknown>;
}

export interface PrivilegedBrokerHandler {
  readonly implementationId: string;
  execute(input: PrivilegedBrokerRequest): Promise<unknown>;
}

/** Immutable registry used by the privileged provisioner HTTP boundary. */
export class PrivilegedBrokerRegistry {
  private readonly handlers: ReadonlyMap<string, PrivilegedBrokerHandler>;

  constructor(handlers: readonly PrivilegedBrokerHandler[]) {
    const entries = handlers.map((handler) => [handler.implementationId, handler] as const);
    if (new Set(entries.map(([id]) => id)).size !== entries.length) {
      throw new Error("Duplicate privileged broker handler implementation ID.");
    }
    this.handlers = new Map(entries);
  }

  async execute(implementationId: string, input: PrivilegedBrokerRequest): Promise<unknown> {
    const handler = this.handlers.get(implementationId);
    if (!handler) {
      throw new Error(`Privileged broker implementation is unavailable: ${implementationId}.`);
    }
    return handler.execute(input);
  }
}
