import { createServer } from "node:http";
import { once } from "node:events";

import { describe, expect, it } from "vitest";

import type { MatrixGatewayProcessResult } from "@second-brain/matrix-adapter";

import { createMatrixGatewayServer, type MatrixGatewayHttpProcessor } from "./server.js";

const catalogDigest = `sha256:${"a".repeat(64)}`;

describe("matrix-gateway HTTP server", () => {
  it("returns the documented health envelope", async () => {
    await withServer(processor(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        schemaVersion: 1,
        service: "matrix-gateway-test",
        status: "live",
        version: "0.0.0",
        apiVersion: "1",
        catalogDigest,
        dependencies: []
      });
    });
  });

  it("accepts a Matrix event and returns the gateway result", async () => {
    await withServer(
      processor({
        result: {
          status: "submitted",
          inboundMessageId: "inbound-1",
          duplicate: false
        }
      }),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/matrix-events`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "m.room.message" })
        });

        expect(response.status).toBe(202);
        await expect(response.json()).resolves.toEqual({
          status: "submitted",
          inboundMessageId: "inbound-1",
          duplicate: false
        });
      }
    );
  });

  it("passes the parsed body to the gateway processor", async () => {
    const received: unknown[] = [];
    await withServer(
      processor({
        record(receivedEvent: unknown) {
          received.push(receivedEvent);
        },
        result: { status: "ignored", reason: "not_authorized" }
      }),
      async (baseUrl) => {
        const body = { type: "m.room.message", sender: "@owner:example" };
        const response = await fetch(`${baseUrl}/v1/matrix-events`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        });

        expect(response.status).toBe(202);
        await expect(response.json()).resolves.toEqual({
          status: "ignored",
          reason: "not_authorized"
        });
        expect(received).toEqual([body]);
      }
    );
  });

  it("returns 404 for unknown routes", async () => {
    await withServer(processor(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/unknown`);
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "not_found" });
    });
  });

  it("pings the control plane and reports ready when /health returns 2xx", async () => {
    const controlPlane = await startFakeControlPlane(200);
    try {
      await withServer(
        processor(),
        async (baseUrl) => {
          const response = await fetch(`${baseUrl}/health`);
          expect(response.status).toBe(200);
          await expect(response.json()).resolves.toMatchObject({
            schemaVersion: 1,
            service: "matrix-gateway-test",
            status: "ready",
            dependencies: [{ name: "control-plane", status: "ready" }]
          });
        },
        { controlBaseUrl: controlPlane.baseUrl }
      );
    } finally {
      await controlPlane.close();
    }
  });

  it("reports 503 with an unavailable control plane when the ping fails", async () => {
    const controlPlane = await startFakeControlPlane(503);
    try {
      await withServer(
        processor(),
        async (baseUrl) => {
          const response = await fetch(`${baseUrl}/health`);
          expect(response.status).toBe(503);
          await expect(response.json()).resolves.toMatchObject({
            schemaVersion: 1,
            service: "matrix-gateway-test",
            status: "unavailable",
            dependencies: [
              {
                name: "control-plane",
                status: "unavailable",
                failureKind: "dependency_unavailable"
              }
            ]
          });
        },
        { controlBaseUrl: controlPlane.baseUrl }
      );
    } finally {
      await controlPlane.close();
    }
  });

  it("classifies a control-plane transport failure as dependency unavailable", async () => {
    await withServer(
      processor(),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/health`);
        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toMatchObject({
          status: "unavailable",
          dependencies: [
            {
              name: "control-plane",
              status: "unavailable",
              failureKind: "dependency_unavailable"
            }
          ]
        });
      },
      { controlBaseUrl: "http://127.0.0.1:1" }
    );
  });

  it("reports degraded readiness when Brain Control omits its API version", async () => {
    const controlPlane = await startFakeControlPlane(200, catalogDigest, null);
    try {
      await withServer(
        processor(),
        async (baseUrl) => {
          const response = await fetch(`${baseUrl}/health`);
          expect(response.status).toBe(503);
          await expect(response.json()).resolves.toMatchObject({
            status: "degraded",
            catalogDigest,
            dependencies: [
              {
                name: "control-plane",
                status: "degraded",
                failureKind: "api_incompatible",
                detail: "Internal API version is missing."
              }
            ]
          });
        },
        { controlBaseUrl: controlPlane.baseUrl }
      );
    } finally {
      await controlPlane.close();
    }
  });

  it("stays ready when Brain Control uses a different catalog", async () => {
    const controlPlane = await startFakeControlPlane(200, `sha256:${"b".repeat(64)}`);
    try {
      await withServer(
        processor(),
        async (baseUrl) => {
          const response = await fetch(`${baseUrl}/health`);
          expect(response.status).toBe(200);
          await expect(response.json()).resolves.toMatchObject({
            status: "ready",
            catalogDigest,
            dependencies: [
              {
                name: "control-plane",
                status: "ready"
              }
            ]
          });
        },
        { controlBaseUrl: controlPlane.baseUrl }
      );
    } finally {
      await controlPlane.close();
    }
  });

  it("reports degraded readiness when Brain Control uses a different policy", async () => {
    const policyDigest = `sha256:${"c".repeat(64)}`;
    const controlPlane = await startFakeControlPlane(
      200,
      `sha256:${"b".repeat(64)}`,
      "1",
      undefined,
      `sha256:${"d".repeat(64)}`
    );
    try {
      await withServer(
        processor(),
        async (baseUrl) => {
          const response = await fetch(`${baseUrl}/health`);
          expect(response.status).toBe(503);
          await expect(response.json()).resolves.toMatchObject({
            status: "degraded",
            policyDigest,
            dependencies: [
              {
                name: "control-plane",
                status: "degraded",
                failureKind: "policy_mismatch"
              }
            ]
          });
        },
        { controlBaseUrl: controlPlane.baseUrl, policyDigest }
      );
    } finally {
      await controlPlane.close();
    }
  });

  it("reports degraded readiness for an incompatible Brain Control API version", async () => {
    const controlPlane = await startFakeControlPlane(200, catalogDigest, "2");
    try {
      await withServer(
        processor(),
        async (baseUrl) => {
          const response = await fetch(`${baseUrl}/health`);
          expect(response.status).toBe(503);
          await expect(response.json()).resolves.toMatchObject({
            status: "degraded",
            catalogDigest,
            dependencies: [
              {
                name: "control-plane",
                status: "degraded",
                failureKind: "api_incompatible",
                detail: "Internal API version 2 is incompatible."
              }
            ]
          });
        },
        { controlBaseUrl: controlPlane.baseUrl }
      );
    } finally {
      await controlPlane.close();
    }
  });

  it("reports an incompatible API for a malformed Brain Control envelope", async () => {
    const controlPlane = await startFakeControlPlane(200, catalogDigest, "1", { malformed: true });
    try {
      await withServer(
        processor(),
        async (baseUrl) => {
          const response = await fetch(`${baseUrl}/health`);
          expect(response.status).toBe(503);
          await expect(response.json()).resolves.toMatchObject({
            status: "unavailable",
            catalogDigest,
            dependencies: [
              {
                name: "control-plane",
                status: "unavailable",
                failureKind: "api_incompatible",
                detail: "Health endpoint returned an invalid envelope."
              }
            ]
          });
        },
        { controlBaseUrl: controlPlane.baseUrl }
      );
    } finally {
      await controlPlane.close();
    }
  });
});

function processor(
  input: {
    result?: MatrixGatewayProcessResult;
    record?: (event: unknown) => void;
  } = {}
): MatrixGatewayHttpProcessor {
  return {
    async process(event) {
      input.record?.(event);
      return (
        input.result ?? {
          status: "submitted",
          inboundMessageId: "inbound-default",
          duplicate: false
        }
      );
    }
  };
}

async function withServer(
  gatewayProcessor: MatrixGatewayHttpProcessor,
  test: (baseUrl: string) => Promise<void>,
  options: { controlBaseUrl?: string; policyDigest?: string } = {}
): Promise<void> {
  const server = createMatrixGatewayServer({
    processor: gatewayProcessor,
    serviceName: "matrix-gateway-test",
    version: "0.0.0",
    catalogDigest,
    ...(options.policyDigest !== undefined ? { policyDigest: options.policyDigest } : {}),
    ...(options.controlBaseUrl !== undefined ? { controlBaseUrl: options.controlBaseUrl } : {})
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected TCP matrix-gateway test server.");
  }
  try {
    await test(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

async function startFakeControlPlane(
  status: number,
  bodyCatalogDigest: string | null = catalogDigest,
  apiVersion: string | null = "1",
  body?: unknown,
  policyDigest?: string
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    response.statusCode = status;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify(
        body ?? {
          schemaVersion: 1,
          service: "brain-control-test",
          status: status >= 200 && status < 300 ? "ready" : "unavailable",
          checkedAt: "2026-01-01T00:00:00.000Z",
          version: "0.0.0",
          ...(apiVersion ? { apiVersion } : {}),
          ...(bodyCatalogDigest ? { catalogDigest: bodyCatalogDigest } : {}),
          ...(policyDigest ? { policyDigest } : {}),
          dependencies: []
        }
      )
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected TCP fake control plane.");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      await once(server, "close");
    }
  };
}
