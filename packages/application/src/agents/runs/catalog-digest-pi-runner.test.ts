import { describe, expect, it, vi } from "vitest";
import type { PiRunRequestV1, PiRunResultV1 } from "@second-brain/contracts";

import { CatalogDigestPiRunner } from "./catalog-digest-pi-runner.js";
import type { PiRunnerPort } from "../../ports.js";

const catalogDigest = `sha256:${"a".repeat(64)}`;

describe("CatalogDigestPiRunner", () => {
  it("stamps the active catalog digest onto every run request", async () => {
    const run = vi.fn<PiRunnerPort["run"]>(async (request) => result(request));
    const runner = new CatalogDigestPiRunner(
      { run, cancel: vi.fn(), cancelSession: vi.fn() },
      { catalogDigest }
    );

    await runner.run(request());

    expect(run).toHaveBeenNthCalledWith(1, expect.objectContaining({ catalogDigest }));
  });

  it("rejects a caller-supplied stale digest instead of silently replacing it", async () => {
    const run = vi.fn<PiRunnerPort["run"]>(async (request) => result(request));
    const runner = new CatalogDigestPiRunner(
      { run, cancel: vi.fn(), cancelSession: vi.fn() },
      { catalogDigest }
    );

    await expect(
      runner.run({ ...request(), catalogDigest: `sha256:${"b".repeat(64)}` })
    ).rejects.toThrow(/catalog digest/i);
    expect(run).not.toHaveBeenCalled();
  });

  it("forwards run and session cancellation without changing their identity", async () => {
    const cancel = vi.fn<PiRunnerPort["cancel"]>();
    const cancelSession = vi.fn<PiRunnerPort["cancelSession"]>();
    const runner = new CatalogDigestPiRunner(
      { run: vi.fn(), cancel, cancelSession },
      { catalogDigest }
    );

    await runner.cancel("run-1");
    await runner.cancelSession("session-1");

    expect(cancel).toHaveBeenCalledExactlyOnceWith("run-1");
    expect(cancelSession).toHaveBeenCalledExactlyOnceWith("session-1");
  });
});

function request(): PiRunRequestV1 {
  return {
    schemaVersion: 1,
    id: "run-1",
    traceId: "trace-1",
    sessionId: "session-1",
    inputText: "Inspect",
    images: [],
    sourceReferences: [],
    timeoutSeconds: 60,
    priority: "background"
  };
}

function result(request: PiRunRequestV1): PiRunResultV1 {
  return {
    schemaVersion: 1,
    id: request.id,
    traceId: request.traceId,
    sessionId: request.sessionId,
    status: "completed",
    generatedFiles: [],
    startedAt: "2026-08-18T20:00:00.000Z",
    finishedAt: "2026-08-18T20:00:01.000Z"
  };
}
