import { once } from "node:events";
import { describe, expect, it } from "vitest";

import {
  InboundMessageV1Schema,
  OutboundMessageV1Schema,
  exampleOutboundMessage
} from "@second-brain/contracts";
import { MatrixGatewayProcessor } from "@second-brain/matrix-adapter";
import { INITIAL_AGENT_CATALOG } from "@second-brain/domain";
import {
  HttpControlPlaneOutboundClient,
  HttpControlPlaneWorkspaceClient,
  HttpControlPlaneSubmitter
} from "../../../apps/matrix-gateway/src/control-plane/control-plane-client.js";
import { createMatrixGatewayServer } from "../../../apps/matrix-gateway/src/server.js";
import { noOpMatrixTypingIndicator } from "../../../apps/matrix-gateway/src/matrix/sync/matrix-typing.js";

const catalogDigest = `sha256:${"a".repeat(64)}`;

describe("matrix-gateway → brain-control integration", () => {
  it("submits a Matrix event through both HTTP boundaries and stores the inbound message", async () => {
    const controlPlane = await startBrainControl();
    const gateway = await startMatrixGateway({
      controlBaseUrl: controlPlane.baseUrl
    });
    try {
      const marker = `${Date.now()}`;
      const matrixEvent = {
        type: "m.room.message",
        event_id: `$matrix-event-cross-service-${marker}`,
        room_id: "!brain:integration",
        sender: "@owner:integration",
        origin_server_ts: Date.parse("2026-07-17T15:00:00.000Z"),
        content: { msgtype: "m.text", body: "hello from the cross-service integration test" }
      };
      const submit = await fetch(`${gateway.baseUrl}/v1/matrix-events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(matrixEvent)
      });
      expect(submit.status).toBe(202);
      const accepted = (await submit.json()) as {
        status: "submitted";
        inboundMessageId: string;
        duplicate: boolean;
      };
      expect(accepted.status).toBe("submitted");
      expect(accepted.duplicate).toBe(false);

      const stored = await fetch(`${controlPlane.baseUrl}/v1/inbound/${accepted.inboundMessageId}`);
      expect(stored.status).toBe(200);
      const storedBody = await stored.json();
      const storedMessage = InboundMessageV1Schema.parse(storedBody);
      expect(storedMessage.externalEventId).toBe(matrixEvent.event_id);
      expect(storedMessage.senderId).toBe(matrixEvent.sender);
      expect(storedMessage.conversationId).toBe(matrixEvent.room_id);
      expect(storedMessage.text).toBe(matrixEvent.content.body);

      const health = await fetch(`${gateway.baseUrl}/health`);
      expect(health.status).toBe(200);
      await expect(health.json()).resolves.toMatchObject({
        status: "ready",
        dependencies: [{ name: "control-plane", status: "ready" }]
      });
    } finally {
      await gateway.close();
      await controlPlane.close();
    }
  });

  it("ignores events that fail authorization without surfacing a server error", async () => {
    const controlPlane = await startBrainControl();
    const gateway = await startMatrixGateway({
      controlBaseUrl: controlPlane.baseUrl
    });
    try {
      const response = await fetch(`${gateway.baseUrl}/v1/matrix-events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "m.room.message",
          event_id: "$event-wrong-room",
          room_id: "!other-room:example",
          sender: "@owner:integration",
          origin_server_ts: Date.parse("2026-07-17T15:00:00.000Z"),
          content: { msgtype: "m.text", body: "should be ignored" }
        })
      });
      expect(response.status).toBe(202);
      const body = (await response.json()) as { status: string; reason?: string };
      expect(body.status).toBe("ignored");
      expect(body.reason).toBe("unbound_workspace");
    } finally {
      await gateway.close();
      await controlPlane.close();
    }
  });

  it("completes the outbound delivery round trip through HttpControlPlaneOutboundClient", async () => {
    const controlPlane = await startBrainControl();
    const outboundClient = new HttpControlPlaneOutboundClient(controlPlane.baseUrl);
    const marker = `outbound-cross-service-${Date.now()}`;
    const outbound = {
      ...exampleOutboundMessage,
      id: `${marker}-id`,
      idempotencyKey: marker
    };
    try {
      const createResponse = await fetch(`${controlPlane.baseUrl}/v1/outbound`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(outbound)
      });
      expect(createResponse.status).toBe(201);

      const claimed = await outboundClient.claim(5);
      const ourOutbound = claimed.find((entry) => entry.id === outbound.id);
      expect(ourOutbound).toBeDefined();
      expect(OutboundMessageV1Schema.parse(ourOutbound)).toMatchObject({
        id: outbound.id,
        idempotencyKey: marker
      });

      const deliveryResult = await outboundClient.delivered(
        outbound.id,
        "$matrix-event-delivery-1"
      );
      expect(deliveryResult).toMatchObject({
        outboundMessageId: outbound.id,
        transport: "matrix",
        status: "delivered",
        externalEventId: "$matrix-event-delivery-1"
      });

      const lookup = await fetch(`${controlPlane.baseUrl}/v1/outbound/${outbound.id}/delivered`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ externalEventId: "$matrix-event-delivery-1" })
      });
      expect(lookup.status).toBe(200);
    } finally {
      await controlPlane.close();
    }
  });
});

interface ServerHandle {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startBrainControl(): Promise<ServerHandle> {
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
  const baseUrl = `http://127.0.0.1:${address.port}`;
  await fetch(`${baseUrl}/v1/workspaces/accept-trusted-invite`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomId: "!brain:integration" })
  });
  return {
    baseUrl,
    close: async () => {
      server.close();
      await once(server, "close");
    }
  };
}

async function startMatrixGateway(options: { controlBaseUrl: string }): Promise<ServerHandle> {
  const processor = new MatrixGatewayProcessor({
    agentCatalog: INITIAL_AGENT_CATALOG,
    auth: {
      ownerMatrixId: "@owner:integration",
      brainUserId: "@brain:integration"
    },
    workspaceResolver: new HttpControlPlaneWorkspaceClient(options.controlBaseUrl),
    submitter: new HttpControlPlaneSubmitter(options.controlBaseUrl, noOpMatrixTypingIndicator)
  });
  const server = createMatrixGatewayServer({
    processor,
    serviceName: "matrix-gateway-integration",
    version: "0.0.0",
    catalogDigest,
    controlBaseUrl: options.controlBaseUrl
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected TCP matrix-gateway integration server.");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      await once(server, "close");
    }
  };
}
