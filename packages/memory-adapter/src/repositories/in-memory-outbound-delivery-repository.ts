import type { OutboundDeliveryPort } from "@second-brain/application";
import type { DeliveryResultV1, OutboundMessageV1 } from "@second-brain/contracts";

import type { InMemoryOutboundRepository } from "./in-memory-outbound-repository.js";

export class InMemoryOutboundDeliveryRepository implements OutboundDeliveryPort {
  private readonly statuses = new Map<
    string,
    DeliveryResultV1["status"] | "pending" | "delivering"
  >();

  constructor(private readonly outbounds: InMemoryOutboundRepository) {}

  async claim(input: {
    transport: DeliveryResultV1["transport"];
    now: Date;
    limit: number;
  }): Promise<OutboundMessageV1[]> {
    const claimable = this.outbounds
      .snapshot()
      .filter((message) => {
        const status = this.statuses.get(message.id) ?? "pending";
        return status === "pending" || status === "retry_wait";
      })
      .slice(0, input.limit);
    for (const message of claimable) {
      this.statuses.set(message.id, "delivering");
    }
    return claimable;
  }

  async markDelivered(input: {
    outboundMessageId: string;
    transport: DeliveryResultV1["transport"];
    externalEventId: string;
    now: Date;
  }): Promise<DeliveryResultV1> {
    this.requireOutbound(input.outboundMessageId);
    const result: DeliveryResultV1 = {
      schemaVersion: 1,
      outboundMessageId: input.outboundMessageId,
      transport: input.transport,
      externalEventId: input.externalEventId,
      status: "delivered",
      deliveredAt: input.now.toISOString()
    };
    this.statuses.set(input.outboundMessageId, "delivered");
    return result;
  }

  async markRetry(input: {
    outboundMessageId: string;
    transport: DeliveryResultV1["transport"];
    now: Date;
    error: NonNullable<DeliveryResultV1["error"]>;
  }): Promise<DeliveryResultV1> {
    this.requireOutbound(input.outboundMessageId);
    const result: DeliveryResultV1 = {
      schemaVersion: 1,
      outboundMessageId: input.outboundMessageId,
      transport: input.transport,
      status: "retry_wait",
      error: input.error
    };
    this.statuses.set(input.outboundMessageId, "retry_wait");
    return result;
  }

  async markFailed(input: {
    outboundMessageId: string;
    transport: DeliveryResultV1["transport"];
    now: Date;
    error: NonNullable<DeliveryResultV1["error"]>;
  }): Promise<DeliveryResultV1> {
    this.requireOutbound(input.outboundMessageId);
    const result: DeliveryResultV1 = {
      schemaVersion: 1,
      outboundMessageId: input.outboundMessageId,
      transport: input.transport,
      status: "failed",
      error: input.error
    };
    this.statuses.set(input.outboundMessageId, "failed");
    return result;
  }

  private requireOutbound(id: string): void {
    if (!this.outbounds.snapshot().some((message) => message.id === id)) {
      throw new Error(`Unknown outbound message: ${id}`);
    }
  }
}
