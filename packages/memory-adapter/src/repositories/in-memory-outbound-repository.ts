import type { OutboundRepositoryPort } from "@second-brain/application";
import type { OutboundMessageV1 } from "@second-brain/contracts";
import { requireWorkspaceId } from "@second-brain/domain";

export class InMemoryOutboundRepository implements OutboundRepositoryPort {
  private readonly messages = new Map<string, OutboundMessageV1>();
  private readonly idempotencyKeys = new Map<string, string>();

  async create(message: OutboundMessageV1): Promise<OutboundMessageV1> {
    const idempotencyKey = outboundIdempotencyKey(message.idempotencyKey, message.workspaceId);
    const existingId = this.idempotencyKeys.get(idempotencyKey);
    if (existingId) {
      const existing = this.messages.get(existingId);
      if (!existing) {
        throw new Error(`Outbound index points to missing message: ${existingId}`);
      }
      return existing;
    }
    this.messages.set(message.id, message);
    this.idempotencyKeys.set(idempotencyKey, message.id);
    return message;
  }

  async get(id: string): Promise<OutboundMessageV1 | undefined> {
    return this.messages.get(id);
  }

  async getByIdempotencyKey(
    idempotencyKey: string,
    workspaceId?: string
  ): Promise<OutboundMessageV1 | undefined> {
    const id = this.idempotencyKeys.get(outboundIdempotencyKey(idempotencyKey, workspaceId));
    return id ? this.messages.get(id) : undefined;
  }

  snapshot(): OutboundMessageV1[] {
    return [...this.messages.values()];
  }
}

function outboundIdempotencyKey(idempotencyKey: string, workspaceId?: string): string {
  return `${requireWorkspaceId(workspaceId, "Idempotency key")}\u001f${idempotencyKey}`;
}
