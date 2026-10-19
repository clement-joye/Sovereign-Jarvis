import type { OutboundJobCompletionPort } from "@second-brain/application/ports/jobs";
import type { OutboundMessageV1 } from "@second-brain/contracts/schemas";

import { PostgresJobQueue } from "./job-queue.js";
import { PostgresOutboundRepository } from "./repositories/outbound-repository.js";
import {
  withTransaction,
  type PostgresTransactionSource,
  type PostgresTransactionalClient
} from "./transaction.js";

export interface PostgresOutboundCompletionServiceOptions {
  db: PostgresTransactionSource;
}

export class PostgresOutboundCompletionService implements OutboundJobCompletionPort {
  private readonly db: PostgresTransactionSource;

  constructor(options: PostgresOutboundCompletionServiceOptions) {
    this.db = options.db;
  }

  async createOutboundAndComplete(input: {
    outbound: OutboundMessageV1;
    jobId: string;
    leaseOwner: string;
  }): Promise<OutboundMessageV1> {
    return withTransaction(this.db, (client) => createOutboundAndCompleteWithClient(client, input));
  }
}

async function createOutboundAndCompleteWithClient(
  client: PostgresTransactionalClient,
  input: {
    outbound: OutboundMessageV1;
    jobId: string;
    leaseOwner: string;
  }
): Promise<OutboundMessageV1> {
  const outbounds = new PostgresOutboundRepository({ db: client });
  const jobs = new PostgresJobQueue({ db: client });
  const outbound = await outbounds.create(input.outbound);
  await jobs.complete({ jobId: input.jobId, leaseOwner: input.leaseOwner });
  return outbound;
}
