import type { InboundMessageRepositoryPort } from "@second-brain/application";
import type { InboundMessageV1 } from "@second-brain/contracts";

export class InMemoryInboundMessageRepository implements InboundMessageRepositoryPort {
  private readonly messages = new Map<string, InboundMessageV1>();
  private readonly transportEvents = new Map<string, string>();
  private readonly transcripts = new Map<string, string>();

  async create(
    message: InboundMessageV1
  ): Promise<
    { message: InboundMessageV1; duplicate: false } | { message: InboundMessageV1; duplicate: true }
  > {
    const key = this.transportKey(message.transport, message.externalEventId);
    const existingId = this.transportEvents.get(key);
    if (existingId) {
      const existing = this.messages.get(existingId);
      if (!existing) {
        throw new Error(`Inbound index points to missing message: ${existingId}`);
      }
      return { message: existing, duplicate: true };
    }

    this.messages.set(message.id, message);
    this.transportEvents.set(key, message.id);
    return { message, duplicate: false };
  }

  async get(id: string): Promise<InboundMessageV1 | undefined> {
    return this.messages.get(id);
  }

  async getByTransportEvent(input: {
    transport: InboundMessageV1["transport"];
    externalEventId: string;
  }): Promise<InboundMessageV1 | undefined> {
    const id = this.transportEvents.get(this.transportKey(input.transport, input.externalEventId));
    return id ? this.messages.get(id) : undefined;
  }

  async saveAudioTranscript(input: {
    id: string;
    workspaceId: string;
    text: string;
  }): Promise<void> {
    const message = this.messages.get(input.id);
    if (!message || message.workspaceId !== input.workspaceId || message.kind !== "audio") {
      throw new Error("Audio message was not found in the requested workspace.");
    }
    this.transcripts.set(input.id, input.text);
  }

  snapshot(): InboundMessageV1[] {
    return [...this.messages.values()];
  }

  private transportKey(transport: InboundMessageV1["transport"], externalEventId: string): string {
    return `${transport}:${externalEventId}`;
  }
}
