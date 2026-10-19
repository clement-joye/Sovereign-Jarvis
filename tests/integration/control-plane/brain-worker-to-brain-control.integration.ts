import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  InboundAcceptanceResponseV1Schema,
  InboundMessageV1Schema,
  exampleInboundMessage
} from "@second-brain/contracts";
import { HttpJobQueue } from "@second-brain/brain-worker";
import { INITIAL_AGENT_CATALOG } from "@second-brain/domain";

describe("brain-worker → brain-control job lifecycle", () => {
  it("claims and completes a queued inbound job through HttpJobQueue", async () => {
    const controlPlane = await startBrainControl();
    const jobClient = new HttpJobQueue(controlPlane.baseUrl);
    const marker = `${Date.now()}`;
    const event = {
      ...exampleInboundMessage,
      workspaceId: controlPlane.workspaceId,
      id: `inbound-brain-worker-${marker}`,
      externalEventId: `$matrix-event-brain-worker-${marker}`,
      traceId: `trace-brain-worker-${marker}`
    };
    try {
      const accept = await fetch(`${controlPlane.baseUrl}/v1/inbound/matrix`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event)
      });
      expect(accept.status).toBe(202);
      const accepted = InboundAcceptanceResponseV1Schema.parse(await accept.json());
      expect(accepted.inboundMessageId).toBe(event.id);
      expect(typeof accepted.jobId).toBe("string");

      const stored = await fetch(`${controlPlane.baseUrl}/v1/inbound/${event.id}`);
      expect(stored.status).toBe(200);
      expect(InboundMessageV1Schema.parse(await stored.json())).toEqual(event);

      const workerId = `brain-worker-test-${marker}`;
      const claimed = await jobClient.claim({
        workerId,
        limit: 10,
        now: new Date(),
        leaseMs: 30_000
      });
      expect(claimed.length).toBe(1);
      expect(claimed[0]?.id).toBe(accepted.jobId);
      expect(claimed[0]?.leaseOwner).toBe(workerId);

      await jobClient.complete({ jobId: accepted.jobId, leaseOwner: workerId });

      const snapshot = await fetch(`${controlPlane.baseUrl}/v1/jobs`);
      expect(snapshot.status).toBe(200);
      const jobs = (await snapshot.json()) as Array<{ id: string; status: string }>;
      const processedJob = jobs.find((entry) => entry.id === accepted.jobId);
      expect(processedJob).toBeDefined();
      expect(processedJob?.status).toBe("completed");
    } finally {
      await controlPlane.close();
    }
  });

  it("fails a claimed job and surfaces retry_wait through HttpJobQueue", async () => {
    const controlPlane = await startBrainControl();
    const jobClient = new HttpJobQueue(controlPlane.baseUrl);
    const marker = `${Date.now()}`;
    const event = {
      ...exampleInboundMessage,
      workspaceId: controlPlane.workspaceId,
      id: `inbound-brain-worker-fail-${marker}`,
      externalEventId: `$matrix-event-brain-worker-fail-${marker}`,
      traceId: `trace-brain-worker-fail-${marker}`
    };
    try {
      const accept = await fetch(`${controlPlane.baseUrl}/v1/inbound/matrix`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event)
      });
      expect(accept.status).toBe(202);
      const accepted = InboundAcceptanceResponseV1Schema.parse(await accept.json());

      const workerId = `brain-worker-fail-${marker}`;
      const claimed = await jobClient.claim({
        workerId,
        limit: 5,
        now: new Date(),
        leaseMs: 30_000
      });
      const ourJob = claimed.find((entry) => entry.id === accepted.jobId);
      expect(ourJob).toBeDefined();

      const failed = await jobClient.fail({
        jobId: accepted.jobId,
        leaseOwner: workerId,
        now: new Date(),
        retryable: true,
        reason: "transient pi runner timeout",
        retryDelayMs: 1000,
        maxAttempts: 3
      });
      expect(failed.status).toBe("retry_wait");
    } finally {
      await controlPlane.close();
    }
  });
});

interface ServerHandle {
  baseUrl: string;
  workspaceId: string;
  close: () => Promise<void>;
}

async function startBrainControl(): Promise<ServerHandle> {
  process.env.JARVIS_PLUGIN_ROOT = fileURLToPath(new URL("../../../plugins", import.meta.url));
  const { createBrainControlServer } = await import("@second-brain/brain-control");
  const server = await createBrainControlServer({
    env: process.env,
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
  const invitation = await fetch(`${baseUrl}/v1/workspaces/accept-trusted-invite`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomId: exampleInboundMessage.conversationId })
  });
  const accepted = (await invitation.json()) as { workspaceId: string };
  return {
    baseUrl,
    workspaceId: accepted.workspaceId,
    close: async () => {
      server.close();
      await once(server, "close");
    }
  };
}
