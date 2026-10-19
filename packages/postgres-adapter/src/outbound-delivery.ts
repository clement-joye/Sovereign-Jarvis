import type { OutboundDeliveryPort } from "@second-brain/application/ports/jobs";
import type { DeliveryResultV1, OutboundMessageV1 } from "@second-brain/contracts/schemas";

import type { PostgresQueryable } from "./postgres-queryable.js";
import { PostgresOutboundRepository } from "./repositories/outbound-repository.js";
import { typedDatabase, type TypedPostgresDatabase } from "./typed-database.js";

export interface PostgresOutboundDeliveryRepositoryOptions {
  db: PostgresQueryable;
}

export class PostgresOutboundDeliveryRepository implements OutboundDeliveryPort {
  private readonly rawDb: PostgresQueryable;
  private readonly db: TypedPostgresDatabase;
  private readonly outbounds: PostgresOutboundRepository;

  constructor(options: PostgresOutboundDeliveryRepositoryOptions) {
    this.rawDb = options.db;
    this.db = typedDatabase(options.db);
    this.outbounds = new PostgresOutboundRepository({ db: options.db });
  }

  async claim(input: {
    transport: DeliveryResultV1["transport"];
    now: Date;
    limit: number;
  }): Promise<OutboundMessageV1[]> {
    const result = await this.rawDb.query<{ id: string }>(
      `
        WITH candidates AS (
          SELECT id
          FROM brain_core.outbound_messages
          WHERE status IN ('pending', 'retry_wait')
          ORDER BY created_at ASC, id ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE brain_core.outbound_messages AS outbound
        SET status = 'delivering'
        FROM candidates
        WHERE outbound.id = candidates.id
        RETURNING outbound.id
      `,
      [input.limit]
    );

    const messages: OutboundMessageV1[] = [];
    for (const row of result.rows) {
      const message = await this.outbounds.get(row.id);
      if (message) {
        messages.push(message);
      }
    }
    return messages;
  }

  async markDelivered(input: {
    outboundMessageId: string;
    transport: DeliveryResultV1["transport"];
    externalEventId: string;
    now: Date;
  }): Promise<DeliveryResultV1> {
    const result = deliveryResult({
      outboundMessageId: input.outboundMessageId,
      transport: input.transport,
      status: "delivered",
      externalEventId: input.externalEventId,
      deliveredAt: input.now.toISOString()
    });
    await this.recordAttempt({
      id: attemptId(result, input.now),
      result,
      attemptedAt: input.now
    });
    await this.updateOutboundStatus({
      outboundMessageId: input.outboundMessageId,
      status: "delivered",
      now: input.now
    });
    return result;
  }

  async markRetry(input: {
    outboundMessageId: string;
    transport: DeliveryResultV1["transport"];
    now: Date;
    error: DeliveryResultV1["error"];
  }): Promise<DeliveryResultV1> {
    const result = deliveryResult({
      outboundMessageId: input.outboundMessageId,
      transport: input.transport,
      status: "retry_wait",
      error: input.error
    });
    await this.recordAttempt({
      id: attemptId(result, input.now),
      result,
      attemptedAt: input.now
    });
    await this.updateOutboundStatus({
      outboundMessageId: input.outboundMessageId,
      status: "retry_wait",
      now: input.now
    });
    return result;
  }

  async markFailed(input: {
    outboundMessageId: string;
    transport: DeliveryResultV1["transport"];
    now: Date;
    error: DeliveryResultV1["error"];
  }): Promise<DeliveryResultV1> {
    const result = deliveryResult({
      outboundMessageId: input.outboundMessageId,
      transport: input.transport,
      status: "failed",
      error: input.error
    });
    await this.recordAttempt({
      id: attemptId(result, input.now),
      result,
      attemptedAt: input.now
    });
    await this.updateOutboundStatus({
      outboundMessageId: input.outboundMessageId,
      status: "failed",
      now: input.now
    });
    return result;
  }

  private async recordAttempt(input: {
    id: string;
    result: DeliveryResultV1;
    attemptedAt: Date;
  }): Promise<void> {
    await this.db
      .withSchema("brain_core")
      .insertInto("delivery_attempts")
      .values((expression) => ({
        id: input.id,
        workspace_id: expression
          .selectFrom("outbound_messages")
          .select("workspace_id")
          .where("id", "=", input.result.outboundMessageId),
        outbound_message_id: input.result.outboundMessageId,
        transport: input.result.transport,
        external_event_id: input.result.externalEventId ?? null,
        status: input.result.status,
        error: input.result.error ?? null,
        attempted_at: input.attemptedAt
      }))
      .execute();
  }

  private async updateOutboundStatus(input: {
    outboundMessageId: string;
    status: DeliveryResultV1["status"] | "delivering";
    now: Date;
  }): Promise<void> {
    const update = this.db
      .withSchema("brain_core")
      .updateTable("outbound_messages")
      .set("status", input.status);
    const result = await (
      input.status === "delivered" ? update.set("delivered_at", input.now) : update
    )
      .where("id", "=", input.outboundMessageId)
      .executeTakeFirst();
    if (result.numUpdatedRows === 0n) {
      throw new Error(`Unknown outbound message: ${input.outboundMessageId}`);
    }
  }
}

function deliveryResult(input: Omit<DeliveryResultV1, "schemaVersion">): DeliveryResultV1 {
  return {
    schemaVersion: 1,
    ...input
  };
}

function attemptId(result: DeliveryResultV1, now: Date): string {
  return `delivery-${result.outboundMessageId}-${result.transport}-${result.status}-${now.getTime()}`;
}
