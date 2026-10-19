import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import {
  exampleInboundMessage,
  exampleOutboundMessage,
  ConversationSessionContextResponseV1Schema,
  ConversationVoicePreferenceResponseV1Schema,
  HealthStatusV1Schema,
  InboundAcceptanceResponseV1Schema,
  InboundMessageV1Schema,
  InternalJobV1Schema,
  ScheduleMutationResultV1Schema,
  ScheduledExecutionV1Schema,
  ScheduledJobV1Schema
} from "@second-brain/contracts";
import { INITIAL_AGENT_CATALOG } from "@second-brain/domain";

import { createBrainControlServer } from "./index.js";

describe("Brain Control HTTP server", () => {
  const catalogDigest = `sha256:${"a".repeat(64)}`;
  let server: Server;
  let baseUrl: string;
  let workspaceId: string;

  beforeEach(async () => {
    server = await createBrainControlServer({
      catalogDigest,
      agentCatalog: INITIAL_AGENT_CATALOG,
      pluginCatalog: { get: () => undefined, list: () => [] }
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    const invitation = await fetch(`${baseUrl}/v1/workspaces/accept-trusted-invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomId: exampleInboundMessage.conversationId })
    });
    const accepted = (await invitation.json()) as { workspaceId: string };
    workspaceId = accepted.workspaceId;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("returns the standard health envelope", async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(HealthStatusV1Schema.parse(await response.json())).toMatchObject({
      service: "brain-control",
      status: "live",
      apiVersion: "1",
      catalogDigest
    });
  });

  it("reports aggregate status through the admin route handler", async () => {
    const response = await fetch(`${baseUrl}/v1/admin/status`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      service: "brain-control",
      status: "ready",
      jobs: expect.any(Number),
      schedules: expect.any(Number),
      sessions: expect.any(Number)
    });
  });

  it("returns a stable bad-request response for malformed JSON", async () => {
    const response = await fetch(`${baseUrl}/v1/jobs/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{"
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_json" });
  });

  it("returns validation errors without invoking a route operation", async () => {
    const response = await fetch(`${baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "session-1" })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_session_create_request"
    });
  });

  it("rejects execution updates whose body and path identifiers differ", async () => {
    const response = await fetch(`${baseUrl}/v1/executions/execution-route-path-id`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        id: "execution-route-body-id",
        scheduleId: "schedule-route-test",
        scheduledFor: "2026-01-01T10:00:00.000Z",
        status: "created",
        attempt: 0,
        createdAt: "2026-01-01T10:00:00.000Z"
      })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "execution_id_mismatch" });
  });

  it("sets and reads voice preferences through the conversation route handler", async () => {
    const setResponse = await fetch(`${baseUrl}/v1/conversation-preferences/voice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        conversationId: "voice-preference-route-test",
        enabled: true
      })
    });
    expect(setResponse.status).toBe(200);
    expect(ConversationVoicePreferenceResponseV1Schema.parse(await setResponse.json())).toEqual({
      enabled: true
    });

    const getResponse = await fetch(`${baseUrl}/v1/conversation-preferences/voice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, conversationId: "voice-preference-route-test" })
    });
    expect(getResponse.status).toBe(200);
    expect(ConversationVoicePreferenceResponseV1Schema.parse(await getResponse.json())).toEqual({
      enabled: true
    });

    const otherWorkspaceResponse = await fetch(`${baseUrl}/v1/conversation-preferences/voice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace-other",
        conversationId: "voice-preference-route-test"
      })
    });
    expect(otherWorkspaceResponse.status).toBe(200);
    expect(
      ConversationVoicePreferenceResponseV1Schema.parse(await otherWorkspaceResponse.json())
    ).toEqual({ enabled: false });
  });

  it("sets, reads, and resets session context through the conversation route handler", async () => {
    const path = `${baseUrl}/v1/conversation-preferences/session-context`;
    const headers = { "content-type": "application/json" };
    const scope = { workspaceId, conversationId: "session-context-route-test" };

    const setResponse = await fetch(path, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...scope, mode: "persistent", historyLimit: 4 })
    });
    expect(ConversationSessionContextResponseV1Schema.parse(await setResponse.json())).toEqual({
      mode: "persistent",
      historyLimit: 4
    });

    const getResponse = await fetch(path, {
      method: "POST",
      headers,
      body: JSON.stringify(scope)
    });
    expect(ConversationSessionContextResponseV1Schema.parse(await getResponse.json())).toEqual({
      mode: "persistent",
      historyLimit: 4
    });

    const resetResponse = await fetch(path, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...scope, mode: null, historyLimit: null })
    });
    expect(ConversationSessionContextResponseV1Schema.parse(await resetResponse.json())).toEqual(
      {}
    );
  });

  it("creates and retrieves a session through the session route handler", async () => {
    const session = {
      id: "session-route-http-test",
      workspaceId: "workspace-example",
      status: "active",
      createdAt: "2026-01-01T10:00:00.000Z",
      lastActiveAt: "2026-01-01T10:00:00.000Z",
      idleExpiresAt: "2026-01-01T11:00:00.000Z",
      absoluteExpiresAt: "2026-01-02T10:00:00.000Z",
      piSessionKey: "pi-session-route-http-test",
      sourceType: "default-room"
    };
    const createResponse = await fetch(`${baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(session)
    });

    expect(createResponse.status).toBe(201);
    expect(await createResponse.json()).toMatchObject(session);

    const getResponse = await fetch(
      `${baseUrl}/v1/sessions/${session.id}?workspaceId=${session.workspaceId}`
    );
    expect(getResponse.status).toBe(200);
    expect(await getResponse.json()).toMatchObject(session);
  });

  it("creates and retrieves outbound work through the outbound route handler", async () => {
    const outbound = {
      ...exampleOutboundMessage,
      id: "outbound-route-http-test",
      idempotencyKey: "outbound-route-http-test-key"
    };
    const createResponse = await fetch(`${baseUrl}/v1/outbound`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(outbound)
    });

    expect(createResponse.status).toBe(201);
    expect(await createResponse.json()).toMatchObject(outbound);

    const getResponse = await fetch(`${baseUrl}/v1/outbound/${outbound.id}`);
    expect(getResponse.status).toBe(200);
    expect(await getResponse.json()).toMatchObject(outbound);
  });

  it("creates and retrieves a schedule through the schedule route handler", async () => {
    const createResponse = await fetch(`${baseUrl}/v1/schedules`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace-example",
        destinationConversationId: "!room:example",
        name: "Schedule route HTTP test",
        instruction: "Confirm the schedule route boundary.",
        schedule: { type: "interval", seconds: 60, timezone: "Europe/Stockholm" }
      })
    });

    expect(createResponse.status).toBe(201);
    const created = ScheduleMutationResultV1Schema.parse(await createResponse.json());
    expect(created.schedule.name).toBe("Schedule route HTTP test");

    const getResponse = await fetch(`${baseUrl}/v1/schedules/${created.schedule.id}`);
    expect(getResponse.status).toBe(200);
    expect(ScheduledJobV1Schema.parse(await getResponse.json())).toMatchObject({
      id: created.schedule.id,
      name: "Schedule route HTTP test"
    });
  });

  it("accepts an inbound message and exposes its queued work through the control plane", async () => {
    const acceptedResponse = await fetch(`${baseUrl}/v1/inbound/matrix`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...exampleInboundMessage, workspaceId })
    });

    expect(acceptedResponse.status).toBe(202);
    const accepted = InboundAcceptanceResponseV1Schema.parse(await acceptedResponse.json());
    expect(accepted).toMatchObject({
      inboundMessageId: exampleInboundMessage.id,
      duplicate: false
    });

    const messageResponse = await fetch(`${baseUrl}/v1/inbound/${exampleInboundMessage.id}`);
    expect(messageResponse.status).toBe(200);
    expect(InboundMessageV1Schema.parse(await messageResponse.json())).toEqual({
      ...exampleInboundMessage,
      workspaceId
    });

    const claimResponse = await fetch(`${baseUrl}/v1/jobs/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workerId: "http-test-worker", limit: 1, leaseMs: 30_000 })
    });
    expect(claimResponse.status).toBe(200);
    expect(InternalJobV1Schema.array().parse(await claimResponse.json())).toMatchObject([
      {
        id: accepted.jobId,
        payload: { inboundMessageId: exampleInboundMessage.id },
        status: "leased"
      }
    ]);

    const completeResponse = await fetch(`${baseUrl}/v1/jobs/${accepted.jobId}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leaseOwner: "http-test-worker" })
    });
    expect(completeResponse.status).toBe(200);
    await expect(completeResponse.json()).resolves.toEqual({ ok: true });
  });

  it("runs a retention pass through the admin route handler", async () => {
    const response = await fetch(`${baseUrl}/v1/admin/retention/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: true, limit: 10 })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      dryRun: true,
      eligible: expect.any(Number),
      deletedFiles: expect.any(Array),
      sanitizedRecords: expect.any(Array),
      failures: expect.any(Array)
    });
  });

  it("rejects extra retention-run fields via strict-mode validation", async () => {
    const response = await fetch(`${baseUrl}/v1/admin/retention/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: true, unexpected: true })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_retention_run_request"
    });
  });

  it("rejects invalid retention-run requests before invoking the service", async () => {
    const response = await fetch(`${baseUrl}/v1/admin/retention/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 0 })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_retention_run_request"
    });
  });

  it("returns an empty dead-letter list when no jobs are in the dead-letter state", async () => {
    const response = await fetch(`${baseUrl}/v1/admin/dead-letter`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([]);
  });

  it("lists recent sessions through the session route handler", async () => {
    const response = await fetch(`${baseUrl}/v1/sessions?workspaceId=workspace-example`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([]);
  });

  it("looks up an active binding through the session route handler", async () => {
    const response = await fetch(`${baseUrl}/v1/sessions/active-binding`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace-example",
        conversationId: "lookup-conversation"
      })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toBeNull();
  });

  it("rejects an active-binding request with extra fields via strict-mode validation", async () => {
    const response = await fetch(`${baseUrl}/v1/sessions/active-binding`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: "lookup-conversation", unexpected: true })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_session_binding_lookup_request"
    });
  });

  it("creates and binds a session through the session route handler", async () => {
    const response = await fetch(`${baseUrl}/v1/sessions/bind`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace-example",
        conversationId: "bind-conversation",
        session: {
          id: "session-bind-route-test",
          workspaceId: "workspace-example",
          status: "active",
          createdAt: "2026-01-01T10:00:00.000Z",
          lastActiveAt: "2026-01-01T10:00:00.000Z",
          idleExpiresAt: "2026-01-01T11:00:00.000Z",
          absoluteExpiresAt: "2026-01-02T10:00:00.000Z",
          piSessionKey: "pi-session-bind-route-test",
          sourceType: "default-room"
        }
      })
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      id: "session-bind-route-test",
      status: "active"
    });
  });

  it("touches an existing session through the session route handler", async () => {
    const session = {
      id: "session-touch-route-test",
      workspaceId: "workspace-example",
      status: "active",
      createdAt: "2026-01-01T10:00:00.000Z",
      lastActiveAt: "2026-01-01T10:00:00.000Z",
      idleExpiresAt: "2026-01-01T11:00:00.000Z",
      absoluteExpiresAt: "2026-01-02T10:00:00.000Z",
      piSessionKey: "pi-session-touch-route-test",
      sourceType: "default-room"
    };
    const createResponse = await fetch(`${baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(session)
    });
    expect(createResponse.status).toBe(201);

    const touchResponse = await fetch(
      `${baseUrl}/v1/sessions/${session.id}/touch?workspaceId=${session.workspaceId}`,
      {
        method: "POST"
      }
    );
    expect(touchResponse.status).toBe(200);
    await expect(touchResponse.json()).resolves.toMatchObject({ id: session.id });
  });

  it("updates an existing schedule through the schedule route handler", async () => {
    const scheduleId = await createTestSchedule(baseUrl, "Schedule update HTTP test");

    const updateResponse = await fetch(`${baseUrl}/v1/schedules/${scheduleId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedVersion: 1,
        name: "Schedule update HTTP test (renamed)"
      })
    });
    expect(updateResponse.status).toBe(200);
    expect(ScheduleMutationResultV1Schema.parse(await updateResponse.json())).toMatchObject({
      schedule: { id: scheduleId, name: "Schedule update HTTP test (renamed)" }
    });
  });

  it("rejects a schedule update whose expectedVersion is invalid", async () => {
    const scheduleId = await createTestSchedule(baseUrl, "Schedule invalid update HTTP test");

    const response = await fetch(`${baseUrl}/v1/schedules/${scheduleId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: -1, name: "should fail" })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_schedule_update" });
  });

  it("deletes an existing schedule through the schedule route handler", async () => {
    const scheduleId = await createTestSchedule(baseUrl, "Schedule delete HTTP test");

    const deleteResponse = await fetch(`${baseUrl}/v1/schedules/${scheduleId}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: 1 })
    });
    expect(deleteResponse.status).toBe(200);
    expect(ScheduledJobV1Schema.parse(await deleteResponse.json())).toMatchObject({
      id: scheduleId,
      enabled: false
    });
  });

  it("enables and disables a schedule through the schedule route handler", async () => {
    const scheduleId = await createTestSchedule(baseUrl, "Schedule enable HTTP test");

    const enableResponse = await fetch(`${baseUrl}/v1/schedules/${scheduleId}/enable`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: 1 })
    });
    expect(enableResponse.status).toBe(200);
    expect(ScheduleMutationResultV1Schema.parse(await enableResponse.json())).toMatchObject({
      schedule: { id: scheduleId, enabled: true }
    });

    const disableResponse = await fetch(`${baseUrl}/v1/schedules/${scheduleId}/disable`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: 2 })
    });
    expect(disableResponse.status).toBe(200);
    expect(ScheduledJobV1Schema.parse(await disableResponse.json())).toMatchObject({
      id: scheduleId,
      enabled: false
    });
  });

  it("runs a schedule manually through the schedule route handler", async () => {
    const scheduleId = await createTestSchedule(baseUrl, "Schedule run-now HTTP test");

    const runResponse = await fetch(`${baseUrl}/v1/schedules/${scheduleId}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    expect(runResponse.status).toBe(202);
    expect(ScheduledExecutionV1Schema.parse(await runResponse.json())).toMatchObject({
      scheduleId,
      status: "queued"
    });
  });

  it("claims an outbound message through the outbound route handler", async () => {
    const outboundId = await createTestOutbound(baseUrl, "outbound-claim-route-test");

    const claimResponse = await fetch(`${baseUrl}/v1/outbound/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 5 })
    });
    expect(claimResponse.status).toBe(200);
    const claimed = (await claimResponse.json()) as Array<{ id: string }>;
    expect(claimed.map((entry) => entry.id)).toContain(outboundId);
  });

  it("rejects an invalid outbound claim body before invoking delivery", async () => {
    const response = await fetch(`${baseUrl}/v1/outbound/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 0 })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_outbound_claim_request"
    });
  });

  it("marks an outbound delivered through the outbound route handler", async () => {
    const outboundId = await createTestOutbound(baseUrl, "outbound-delivered-route-test");

    const deliveredResponse = await fetch(`${baseUrl}/v1/outbound/${outboundId}/delivered`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ externalEventId: "matrix-event-1" })
    });
    expect(deliveredResponse.status).toBe(200);
    await expect(deliveredResponse.json()).resolves.toMatchObject({
      outboundMessageId: outboundId,
      transport: "matrix",
      status: "delivered",
      externalEventId: "matrix-event-1"
    });
  });

  it("marks an outbound failed through the outbound route handler", async () => {
    const outboundId = await createTestOutbound(baseUrl, "outbound-failed-route-test");

    const failResponse = await fetch(`${baseUrl}/v1/outbound/${outboundId}/fail`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    expect(failResponse.status).toBe(200);
    await expect(failResponse.json()).resolves.toMatchObject({
      outboundMessageId: outboundId,
      transport: "matrix",
      status: "failed"
    });
  });

  it("accepts an anchor-delivered callback and returns ok", async () => {
    const response = await fetch(`${baseUrl}/v1/outbound/anchor-delivered`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        anchorIdempotencyKey: "run_schedule:missing-execution:outbound:anchor",
        anchorExternalEventId: "$anchor-event-1",
        conversationId: "!room:example"
      })
    });
    // The binding is best-effort and silent no-ops when the execution
    // cannot be resolved; the gateway should always see 200.
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("rejects an invalid anchor-delivered body before invoking the binder", async () => {
    const response = await fetch(`${baseUrl}/v1/outbound/anchor-delivered`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ anchorIdempotencyKey: "" })
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_outbound_anchor_delivered_request"
    });
  });

  it("lists jobs through the job route handler", async () => {
    const response = await fetch(`${baseUrl}/v1/jobs`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.any(Array));
  });

  it("fails a claimed job through the job route handler", async () => {
    const { jobId, leaseOwner } = await claimTestJob(baseUrl, workspaceId);

    const failResponse = await fetch(`${baseUrl}/v1/jobs/${jobId}/fail`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        leaseOwner,
        retryable: true,
        reason: "test failure",
        retryDelayMs: 1000
      })
    });
    expect(failResponse.status).toBe(200);
    expect(InternalJobV1Schema.parse(await failResponse.json())).toMatchObject({
      id: jobId,
      payload: { lastError: "test failure" }
    });
  });

  it("rejects an invalid job fail request before invoking the queue", async () => {
    const response = await fetch(`${baseUrl}/v1/jobs/non-existent/fail`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_job_fail_request"
    });
  });

  it("completes a job with an outbound payload through the job route handler", async () => {
    const { jobId, leaseOwner } = await claimTestJob(baseUrl, workspaceId);

    const response = await fetch(`${baseUrl}/v1/jobs/${jobId}/complete-with-outbound`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        leaseOwner,
        outbound: {
          ...exampleOutboundMessage,
          id: "outbound-complete-with-outbound-route-test",
          idempotencyKey: "outbound-complete-with-outbound-route-test-key"
        }
      })
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: "outbound-complete-with-outbound-route-test"
    });
  });

  it("lists schedules through the schedule route handler", async () => {
    await createTestSchedule(baseUrl, "Schedule list HTTP test");

    const response = await fetch(`${baseUrl}/v1/schedules`);
    expect(response.status).toBe(200);
    const listed = (await response.json()) as Array<{ name: string }>;
    expect(listed.map((entry) => entry.name)).toContain("Schedule list HTTP test");
  });

  it("claims due schedules through the schedule route handler", async () => {
    const response = await fetch(`${baseUrl}/v1/schedules/claim-due`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 10 })
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.any(Array));
  });

  it("returns schedule history through the schedule route handler", async () => {
    const scheduleId = await createTestSchedule(baseUrl, "Schedule history HTTP test");

    const response = await fetch(`${baseUrl}/v1/schedules/${scheduleId}/history`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.any(Array));
  });

  it("activates a session binding through the session route handler", async () => {
    const session = {
      id: "session-activate-route-test",
      workspaceId: "workspace-example",
      status: "active",
      createdAt: "2026-01-01T10:00:00.000Z",
      lastActiveAt: "2026-01-01T10:00:00.000Z",
      idleExpiresAt: "2026-01-01T11:00:00.000Z",
      absoluteExpiresAt: "2026-01-02T10:00:00.000Z",
      piSessionKey: "pi-session-activate-route-test",
      sourceType: "default-room"
    };
    await fetch(`${baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(session)
    });

    const response = await fetch(`${baseUrl}/v1/sessions/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: session.id,
        workspaceId: session.workspaceId,
        conversationId: "activate-conversation"
      })
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: session.id
    });
  });

  it("closes a session through the session route handler", async () => {
    const session = {
      id: "session-close-route-test",
      workspaceId: "workspace-example",
      status: "active",
      createdAt: "2026-01-01T10:00:00.000Z",
      lastActiveAt: "2026-01-01T10:00:00.000Z",
      idleExpiresAt: "2026-01-01T11:00:00.000Z",
      absoluteExpiresAt: "2026-01-02T10:00:00.000Z",
      piSessionKey: "pi-session-close-route-test",
      sourceType: "default-room"
    };
    const createResponse = await fetch(`${baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(session)
    });
    expect(createResponse.status).toBe(201);

    const closeResponse = await fetch(
      `${baseUrl}/v1/sessions/${session.id}/close?workspaceId=${session.workspaceId}`,
      {
        method: "POST"
      }
    );
    expect(closeResponse.status).toBe(200);
    await expect(closeResponse.json()).resolves.toMatchObject({ id: session.id, status: "closed" });
  });

  it("looks up an outbound by idempotency key through the outbound route handler", async () => {
    await createTestOutbound(baseUrl, "outbound-idempotency-lookup-test");

    const response = await fetch(
      `${baseUrl}/v1/outbound/idempotency/outbound-idempotency-lookup-test` +
        `?workspaceId=${exampleOutboundMessage.workspaceId}`
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      idempotencyKey: "outbound-idempotency-lookup-test"
    });
  });

  it("returns 404 for an unknown outbound idempotency key", async () => {
    const response = await fetch(
      `${baseUrl}/v1/outbound/idempotency/unknown-key?workspaceId=${exampleOutboundMessage.workspaceId}`
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
  });

  it("marks an outbound for retry through the outbound route handler", async () => {
    const outboundId = await createTestOutbound(baseUrl, "outbound-retry-route-test");

    const retryResponse = await fetch(`${baseUrl}/v1/outbound/${outboundId}/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    expect(retryResponse.status).toBe(200);
    await expect(retryResponse.json()).resolves.toMatchObject({
      outboundMessageId: outboundId,
      transport: "matrix",
      status: "retry_wait"
    });
  });

  it("reports unknown routes as not found", async () => {
    const response = await fetch(`${baseUrl}/v1/unknown`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
  });
});

async function createTestSchedule(baseUrl: string, name: string): Promise<string> {
  const response = await fetch(`${baseUrl}/v1/schedules`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId: "workspace-example",
      destinationConversationId: "!room:example",
      name,
      instruction: "Confirm the schedule action boundary.",
      schedule: { type: "interval", seconds: 60, timezone: "Europe/Stockholm" }
    })
  });
  if (response.status !== 201) {
    throw new Error(`Failed to seed schedule: ${response.status}`);
  }
  const created = ScheduleMutationResultV1Schema.parse(await response.json());
  return created.schedule.id;
}

async function createTestOutbound(baseUrl: string, idempotencyKey: string): Promise<string> {
  const outbound = {
    ...exampleOutboundMessage,
    id: `${idempotencyKey}-id`,
    idempotencyKey
  };
  const response = await fetch(`${baseUrl}/v1/outbound`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(outbound)
  });
  if (response.status !== 201) {
    throw new Error(`Failed to seed outbound: ${response.status}`);
  }
  return outbound.id;
}

async function claimTestJob(
  baseUrl: string,
  workspaceId = "workspace-example"
): Promise<{ jobId: string; leaseOwner: string }> {
  const marker = Math.random().toString(36).slice(2, 10);
  const accept = await fetch(`${baseUrl}/v1/inbound/matrix`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...exampleInboundMessage,
      workspaceId,
      id: `inbound-${marker}`,
      idempotencyKey: `inbound-${marker}`,
      externalEventId: `$matrix-event-${marker}`,
      traceId: `trace-${marker}`
    })
  });
  if (accept.status !== 202) {
    throw new Error(`Failed to seed inbound for job: ${accept.status}`);
  }
  InboundAcceptanceResponseV1Schema.parse(await accept.json());

  const leaseOwner = `claim-helper-${marker}`;
  const claim = await fetch(`${baseUrl}/v1/jobs/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workerId: leaseOwner,
      limit: 50,
      leaseMs: 30_000
    })
  });
  if (claim.status !== 200) {
    throw new Error(`Failed to claim seeded job: ${claim.status}`);
  }
  const claimed = InternalJobV1Schema.array().parse(await claim.json());
  const leased = claimed.find((job) => job.payload.inboundMessageId === `inbound-${marker}`);
  if (!leased) {
    throw new Error(`Seeded job was not among the claimed batch.`);
  }
  return { jobId: leased.id, leaseOwner };
}
