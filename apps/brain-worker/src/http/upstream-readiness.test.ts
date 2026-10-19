import { describe, expect, it, vi } from "vitest";

import type { BrainWorkerConfig } from "@second-brain/configuration";

import { checkUpstreamReadiness } from "./upstream-readiness.js";

const catalogDigest = `sha256:${"a".repeat(64)}`;

const baseConfig: BrainWorkerConfig = {
  controlUrl: "http://control.test",
  mediaWorkerUrl: "http://media.test",
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

function silentLogger(): Parameters<typeof checkUpstreamReadiness>[2] {
  const logger = {
    warn: () => undefined,
    info: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    log: () => undefined,
    withContext: () => silentLogger()
  };
  return logger as Parameters<typeof checkUpstreamReadiness>[2];
}

function warnSpy() {
  const warnings: unknown[] = [];
  const base = {
    info: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    log: () => undefined
  };
  const logger = {
    ...base,
    warn: (message: string, data?: unknown) => {
      warnings.push({ message, data });
    },
    withContext: () => logger
  };
  return {
    warnings,
    logger: logger as Parameters<typeof checkUpstreamReadiness>[2]
  };
}

describe("checkUpstreamReadiness", () => {
  it("reports ready when every upstream /health responds 2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input: string | URL | Request) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("control.test")) {
          return new Response(
            JSON.stringify({
              schemaVersion: 1,
              service: "brain-control",
              status: "ready",
              checkedAt: "2026-08-28T20:00:00.000Z",
              version: "0.0.0",
              apiVersion: "1",
              catalogDigest,
              dependencies: []
            }),
            { status: 200 }
          );
        }
        return new Response("ok", { status: 200 });
      })
    );
    try {
      const result = await checkUpstreamReadiness(baseConfig, catalogDigest, silentLogger());
      expect(result.envelope.status).toBe("ready");
      expect(result.envelope.dependencies).toEqual([
        { name: "brain-control", status: "ready" },
        { name: "media-worker", status: "ready" }
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("requires the matching policy digest when one is supplied locally", async () => {
    const policyDigest = `sha256:${"b".repeat(64)}`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input: string | URL | Request) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("control.test")) {
          return new Response(
            JSON.stringify({
              schemaVersion: 1,
              service: "brain-control",
              status: "ready",
              checkedAt: "2026-08-28T20:00:00.000Z",
              version: "0.0.0",
              apiVersion: "1",
              catalogDigest,
              policyDigest: `sha256:${"c".repeat(64)}`,
              dependencies: []
            }),
            { status: 200 }
          );
        }
        return new Response("ok", { status: 200 });
      })
    );
    try {
      const result = await checkUpstreamReadiness(
        baseConfig,
        catalogDigest,
        policyDigest,
        silentLogger()
      );
      expect(result.envelope.status).toBe("degraded");
      expect(result.envelope.dependencies).toContainEqual({
        name: "brain-control",
        status: "degraded",
        failureKind: "policy_mismatch",
        detail: "Platform policy digest does not match."
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("classifies missing API identity as incompatible", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input: string | URL | Request) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("control.test")) {
          return new Response(
            JSON.stringify({
              schemaVersion: 1,
              service: "brain-control",
              status: "ready",
              checkedAt: "2026-08-28T20:00:00.000Z",
              version: "0.0.0",
              catalogDigest,
              dependencies: []
            }),
            { status: 200 }
          );
        }
        return new Response("ok", { status: 200 });
      })
    );
    try {
      const result = await checkUpstreamReadiness(baseConfig, catalogDigest, silentLogger());
      expect(result.envelope.status).toBe("unavailable");
      expect(result.envelope.dependencies).toContainEqual({
        name: "brain-control",
        status: "unavailable",
        failureKind: "api_incompatible",
        detail: "Expected API version 1."
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reports unavailable and warns when an upstream /health is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false } as Response));
    try {
      const { warnings, logger } = warnSpy();
      const result = await checkUpstreamReadiness(baseConfig, catalogDigest, logger);
      expect(result.envelope.status).toBe("unavailable");
      expect(result.envelope.dependencies).toEqual([
        {
          name: "brain-control",
          status: "unavailable",
          failureKind: "dependency_unavailable",
          detail: "HTTP request failed."
        },
        {
          name: "media-worker",
          status: "unavailable",
          failureKind: "dependency_unavailable",
          detail: "Dependency health request failed."
        }
      ]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        data: {
          dependencies: expect.arrayContaining([
            expect.objectContaining({ name: "brain-control", status: "unavailable" })
          ])
        }
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
