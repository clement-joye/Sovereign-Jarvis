import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { BrainWorkerConfig } from "@second-brain/configuration";
import { checkUpstreamReadiness } from "@second-brain/brain-worker";
import { INITIAL_AGENT_CATALOG } from "@second-brain/domain";

const catalogDigest = `sha256:${"a".repeat(64)}`;

describe("brain-worker upstream readiness", () => {
  it("reports brain-control as ready when its /health endpoint responds 2xx", async () => {
    const controlPlane = await startBrainControl();
    try {
      const config: BrainWorkerConfig = {
        controlUrl: controlPlane.baseUrl,
        mediaWorkerUrl: "http://127.0.0.1:1",
        pollIntervalMs: 60_000,
        sessionIdleContinuationMs: 60_000,
        sessionRetentionMs: 60_000,
        sessionDisplayTimezone: "Europe/Stockholm",
        leaseMs: 60_000,
        claimLimit: 5,
        jobTypes: ["process_inbound", "run_schedule"],
        maxAttempts: 3,
        retryBaseDelayMs: 1_000,
        controlRequestTimeoutMs: 30_000,
        mediaRequestTimeoutMs: 240_000,
        piTimeoutSeconds: 60
      };

      const warnings: unknown[] = [];
      const logger = {
        warn: (message: string, data?: unknown) => {
          warnings.push({ message, data });
        },
        info: () => undefined,
        error: () => undefined,
        debug: () => undefined,
        log: () => undefined
      } as unknown as Parameters<typeof checkUpstreamReadiness>[2];

      const result = await checkUpstreamReadiness(config, catalogDigest, logger);

      const brainControl = result.envelope.dependencies.find(
        (entry) => entry.name === "brain-control"
      );
      expect(brainControl).toEqual({ name: "brain-control", status: "ready" });

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        data: {
          dependencies: expect.arrayContaining([
            expect.objectContaining({ name: "media-worker", status: "unavailable" })
          ])
        }
      });
      expect(result.envelope.status).toBe("unavailable");
    } finally {
      await controlPlane.close();
    }
  });

  it("reports every upstream as unavailable when no real services are running", async () => {
    const config: BrainWorkerConfig = {
      controlUrl: "http://127.0.0.1:1",
      mediaWorkerUrl: "http://127.0.0.1:1",
      pollIntervalMs: 60_000,
      sessionIdleContinuationMs: 60_000,
      sessionRetentionMs: 60_000,
      sessionDisplayTimezone: "Europe/Stockholm",
      leaseMs: 60_000,
      claimLimit: 5,
      jobTypes: ["process_inbound", "run_schedule"],
      maxAttempts: 3,
      retryBaseDelayMs: 1_000,
      controlRequestTimeoutMs: 30_000,
      mediaRequestTimeoutMs: 240_000,
      piTimeoutSeconds: 60
    };

    const result = await checkUpstreamReadiness(config, catalogDigest, silentLogger());

    expect(result.envelope.status).toBe("unavailable");
    expect(result.envelope.dependencies).toEqual([
      {
        name: "brain-control",
        status: "unavailable",
        failureKind: "dependency_unavailable",
        detail: "Dependency health request failed."
      },
      {
        name: "media-worker",
        status: "unavailable",
        failureKind: "dependency_unavailable",
        detail: "Dependency health request failed."
      }
    ]);
  });
});

interface ServerHandle {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startBrainControl(): Promise<ServerHandle> {
  process.env.JARVIS_PLUGIN_ROOT = fileURLToPath(new URL("../../../plugins", import.meta.url));
  const { createBrainControlServer } = await import("@second-brain/brain-control");
  const server = await createBrainControlServer({
    env: process.env,
    catalogDigest,
    agentCatalog: INITIAL_AGENT_CATALOG,
    pluginCatalog: { get: () => undefined, list: () => [] }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected TCP brain-control test server.");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      await once(server, "close");
    }
  };
}

function silentLogger(): Parameters<typeof checkUpstreamReadiness>[2] {
  return {
    warn: () => undefined,
    info: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    log: () => undefined
  } as unknown as Parameters<typeof checkUpstreamReadiness>[2];
}
