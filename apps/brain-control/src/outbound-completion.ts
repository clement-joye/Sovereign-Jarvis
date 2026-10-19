import type { OutboundJobCompletionPort } from "@second-brain/application";
import { type OutboundMessageV1 } from "@second-brain/contracts";
import { PostgresOutboundCompletionService } from "@second-brain/postgres-adapter";

import { type PostgresPool } from "./composition/repository-factories.js";

export interface CreateOutboundAndCompleteContext {
  readonly postgresPool: PostgresPool | undefined;
  readonly outbounds: OutboundJobCompletionContext["outbounds"];
  readonly jobs: OutboundJobCompletionContext["jobs"];
}

interface OutboundJobCompletionContext {
  readonly outbounds: {
    create(outbound: OutboundMessageV1): Promise<OutboundMessageV1>;
  };
  readonly jobs: {
    complete(input: { jobId: string; leaseOwner: string }): Promise<unknown>;
  };
}

/**
 * Builds an `OutboundJobCompletionPort["createOutboundAndComplete"]` helper
 * that prefers the Postgres transactional path when a pool is configured
 * and otherwise atomically writes the outbound and completes the leased
 * job through the in-memory repositories.
 */
export function createOutboundAndComplete(
  context: CreateOutboundAndCompleteContext
): OutboundJobCompletionPort["createOutboundAndComplete"] {
  return async (input) => {
    if (context.postgresPool) {
      return new PostgresOutboundCompletionService({
        db: context.postgresPool as never
      }).createOutboundAndComplete(input);
    }
    const outbound = await context.outbounds.create(input.outbound);
    await context.jobs.complete({ jobId: input.jobId, leaseOwner: input.leaseOwner });
    return outbound;
  };
}
