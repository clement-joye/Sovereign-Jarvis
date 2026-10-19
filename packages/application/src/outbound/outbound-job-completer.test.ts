import { describe, expect, it, vi } from "vitest";

import {
  exampleJob,
  exampleOutboundMessage,
  type OutboundMessageV1
} from "@second-brain/contracts";

import { OutboundJobCompleter } from "./outbound-job-completer.js";
import { OutboundResponseFactory } from "./outbound-response-factory.js";
import type { OutboundRepositoryPort } from "../ports.js";

describe("OutboundJobCompleter", () => {
  it("uses the atomic outbound-completion boundary when available", async () => {
    const outbounds = outboundRepository();
    const jobs = { complete: vi.fn() };
    const completion = {
      createOutboundAndComplete: vi.fn().mockResolvedValue(exampleOutboundMessage)
    };
    const completer = new OutboundJobCompleter(
      new OutboundResponseFactory(outbounds, ids),
      jobs,
      "worker-1",
      completion
    );

    await expect(completer.createAndComplete(exampleJob, responseInput)).resolves.toEqual(
      exampleOutboundMessage
    );
    expect(completion.createOutboundAndComplete).toHaveBeenCalledWith({
      outbound: expect.objectContaining({ id: "outbound-1", idempotencyKey: "outbound-key" }),
      jobId: exampleJob.id,
      leaseOwner: "worker-1"
    });
    expect(outbounds.create).not.toHaveBeenCalled();
    expect(jobs.complete).not.toHaveBeenCalled();
  });

  it("falls back to creating the outbound then completing the job", async () => {
    const outbounds = outboundRepository();
    const jobs = { complete: vi.fn().mockResolvedValue(undefined) };
    const completer = new OutboundJobCompleter(
      new OutboundResponseFactory(outbounds, ids),
      jobs,
      "worker-1",
      undefined
    );

    await completer.createAndComplete(exampleJob, responseInput);

    expect(outbounds.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: "outbound-1", idempotencyKey: "outbound-key" })
    );
    expect(jobs.complete).toHaveBeenCalledWith({ jobId: exampleJob.id, leaseOwner: "worker-1" });
  });

  it("recognizes a previously persisted idempotent outbound", async () => {
    const outbounds = outboundRepository(exampleOutboundMessage);
    const completer = new OutboundJobCompleter(
      new OutboundResponseFactory(outbounds, ids),
      { complete: vi.fn() },
      "worker-1",
      undefined
    );

    await expect(completer.outboundExists("outbound-key", "workspace-example")).resolves.toBe(true);
    await expect(completer.outboundExists("missing", "workspace-example")).resolves.toBe(false);
  });
});

const ids = { nextId: () => "outbound-1" };
const responseInput = {
  idempotencyKey: "outbound-key",
  traceId: exampleJob.id,
  workspaceId: "workspace-example",
  conversationId: "!room:example",
  text: "Done."
};

function outboundRepository(
  existing?: OutboundMessageV1
): Pick<OutboundRepositoryPort, "create" | "get" | "getByIdempotencyKey"> {
  return {
    create: vi.fn<OutboundRepositoryPort["create"]>(async (outbound) => outbound),
    get: vi.fn(),
    getByIdempotencyKey: vi.fn<OutboundRepositoryPort["getByIdempotencyKey"]>(
      async (idempotencyKey) => (idempotencyKey === "outbound-key" ? existing : undefined)
    )
  };
}
