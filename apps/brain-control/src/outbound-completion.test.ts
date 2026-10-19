import { describe, expect, it } from "vitest";

import { exampleOutboundMessage } from "@second-brain/contracts";

import { createOutboundAndComplete } from "./outbound-completion.js";

describe("createOutboundAndComplete (ephemeral mode)", () => {
  it("writes the outbound and completes the leased job through the in-memory repositories", async () => {
    const created: unknown[] = [];
    const completed: Array<{ jobId: string; leaseOwner: string }> = [];
    const complete = createOutboundAndComplete({
      postgresPool: undefined,
      outbounds: {
        async create(outbound) {
          created.push(outbound);
          return outbound;
        }
      },
      jobs: {
        async complete(input) {
          completed.push(input);
        }
      }
    });

    const outbound = {
      ...exampleOutboundMessage,
      id: "outbound-completion-test",
      idempotencyKey: "outbound-completion-test-key"
    };

    const result = await complete({
      outbound,
      jobId: "job-completion-test",
      leaseOwner: "brain-worker-completion-test"
    });

    expect(result).toEqual(outbound);
    expect(created).toEqual([outbound]);
    expect(completed).toEqual([
      { jobId: "job-completion-test", leaseOwner: "brain-worker-completion-test" }
    ]);
  });

  it("does not call the in-memory repositories when a postgres pool is configured", async () => {
    const created: unknown[] = [];
    const completed: Array<{ jobId: string }> = [];
    const fakePool = {
      connect: async () => {
        throw new Error("in-memory path should not be used when a postgres pool is set");
      }
    };
    const complete = createOutboundAndComplete({
      postgresPool: fakePool as never,
      outbounds: {
        async create(outbound) {
          created.push(outbound);
          return outbound;
        }
      },
      jobs: {
        async complete(input) {
          completed.push(input);
        }
      }
    });

    let postgresCalled = false;
    // Patch the imported PostgresOutboundCompletionService through a module-level
    // import is not possible; instead, simulate the postgres branch by throwing
    // a recognizable error from the fake pool's connect() and asserting it
    // propagates — meaning the in-memory branch was not taken.
    try {
      await complete({
        outbound: { ...exampleOutboundMessage, idempotencyKey: "x" },
        jobId: "job-postgres",
        leaseOwner: "owner-postgres"
      });
      throw new Error("expected connect() to be called");
    } catch (error) {
      postgresCalled = error instanceof Error && error.message.includes("in-memory");
    }
    expect(postgresCalled).toBe(true);
    expect(created).toEqual([]);
    expect(completed).toEqual([]);
  });
});
