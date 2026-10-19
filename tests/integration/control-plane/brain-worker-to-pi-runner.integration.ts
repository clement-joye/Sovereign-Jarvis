import { once } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { PiRunResultV1Schema } from "@second-brain/contracts";
import { HttpPiRunner } from "@second-brain/brain-worker";
import {
  createPiRunnerServer,
  type PiRunnerHttpService
} from "../../../apps/pi-runner/src/server.js";

const catalogDigest = `sha256:${"a".repeat(64)}`;

describe("brain-worker → pi-runner integration", () => {
  it("forwards a Pi run to the upstream service and decodes the response", async () => {
    const service = stubService();
    service.run.mockResolvedValue({
      schemaVersion: 1,
      id: "pi-run-integration-test",
      traceId: "trace-integration",
      sessionId: "session-integration",
      status: "completed",
      text: "hello from upstream pi",
      generatedFiles: [],
      startedAt: "2026-07-17T15:00:00.000Z",
      finishedAt: "2026-07-17T15:00:01.000Z"
    });
    const runner = await startPiRunner(service);
    try {
      const client = new HttpPiRunner(runner.baseUrl);
      const result = await client.run({
        schemaVersion: 1,
        id: "pi-run-client",
        catalogDigest,
        traceId: "trace-client",
        sessionId: "session-client",
        inputText: "hello",
        images: [],
        sourceReferences: [],
        timeoutSeconds: 60,
        priority: "interactive"
      });

      expect(service.run).toHaveBeenCalledTimes(1);
      expect(PiRunResultV1Schema.parse(result)).toMatchObject({
        id: "pi-run-integration-test",
        status: "completed",
        text: "hello from upstream pi"
      });
    } finally {
      await runner.close();
    }
  });

  it("forwards a Pi run cancel to the upstream service", async () => {
    const service = stubService();
    const runner = await startPiRunner(service);
    try {
      const client = new HttpPiRunner(runner.baseUrl);
      await client.cancel("pi-run-cancel-1");

      expect(service.cancel).toHaveBeenCalledWith("pi-run-cancel-1");
    } finally {
      await runner.close();
    }
  });

  it("forwards a Pi session cancel to the upstream service", async () => {
    const service = stubService();
    const runner = await startPiRunner(service);
    try {
      const client = new HttpPiRunner(runner.baseUrl);
      await client.cancelSession("pi-session-cancel-1");

      expect(service.cancelSession).toHaveBeenCalledWith("pi-session-cancel-1");
    } finally {
      await runner.close();
    }
  });

  it("rejects the run when the upstream service returns a non-2xx", async () => {
    const service = stubService();
    service.run.mockRejectedValue(new Error("upstream is down"));
    const runner = await startPiRunner(service);
    try {
      const client = new HttpPiRunner(runner.baseUrl);
      await expect(
        client.run({
          schemaVersion: 1,
          id: "pi-run-fail",
          catalogDigest,
          traceId: "trace-fail",
          sessionId: "session-fail",
          inputText: "hello",
          images: [],
          sourceReferences: [],
          timeoutSeconds: 60,
          priority: "interactive"
        })
      ).rejects.toThrow();
    } finally {
      await runner.close();
    }
  });

  it("exposes the upstream /health envelope so brain-worker readiness can probe it", async () => {
    const service = stubService();
    const runner = await startPiRunner(service);
    try {
      const response = await fetch(`${runner.baseUrl}/health`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        schemaVersion: 1,
        service: "pi-runner-integration",
        status: "live"
      });
    } finally {
      await runner.close();
    }
  });
});

interface ServerHandle {
  baseUrl: string;
  close: () => Promise<void>;
}

function stubService(): PiRunnerHttpService & {
  run: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  cancelSession: ReturnType<typeof vi.fn>;
  createSession: ReturnType<typeof vi.fn>;
  closeSession: ReturnType<typeof vi.fn>;
  sessionHealth: ReturnType<typeof vi.fn>;
} {
  return {
    run: vi.fn(),
    cancel: vi.fn(),
    cancelSession: vi.fn(),
    createSession: vi.fn(),
    closeSession: vi.fn(),
    sessionHealth: vi.fn()
  };
}

async function startPiRunner(service: PiRunnerHttpService): Promise<ServerHandle> {
  const server = createPiRunnerServer({
    service,
    serviceName: "pi-runner-integration",
    version: "0.0.0",
    catalogDigest
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected TCP pi-runner test server.");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      await once(server, "close");
    }
  };
}
