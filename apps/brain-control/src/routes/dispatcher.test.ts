import { afterEach, describe, expect, it, vi } from "vitest";

import type { ServerResponse } from "node:http";
import { exampleAttachment, exampleInboundMessage } from "@second-brain/contracts";
import { INITIAL_AGENT_CATALOG } from "@second-brain/domain";

import { dispatchBrainControlRequest, type BrainControlDispatcher } from "./dispatcher.js";
import { createBrainControlRouteRegistry } from "./route-registry.js";

function noopResponse(): ServerResponse {
  const headers: Record<string, string> = {};
  return {
    setHeader(name: string, value: string | number | string[]) {
      headers[name] = String(value);
    },
    getHeader(name: string) {
      return headers[name];
    },
    removeHeader() {
      // no-op
    },
    on() {
      return this as unknown as ServerResponse;
    },
    once() {
      return this as unknown as ServerResponse;
    },
    emit() {
      return false;
    },
    end() {
      // no-op
    },
    write() {
      return true;
    },
    statusCode: 200
  } as unknown as ServerResponse;
}

function makeDispatcher(overrides: Partial<BrainControlDispatcher> = {}): BrainControlDispatcher {
  const writeJson = vi.fn();
  const readJson = vi.fn();
  return {
    serviceName: "brain-control-test",
    version: "0.0.0",
    agentCatalog: INITIAL_AGENT_CATALOG,
    postgresPool: undefined,
    inboundAcceptance: { acceptMatrixInbound: vi.fn() },
    inboundMessages: {
      create: vi.fn(),
      get: vi.fn(),
      getByTransportEvent: vi.fn(),
      saveAudioTranscript: vi.fn()
    },
    jobs: { enqueue: vi.fn(), claim: vi.fn(), complete: vi.fn(), fail: vi.fn(), snapshot: vi.fn() },
    completeWithOutbound: vi.fn<BrainControlDispatcher["completeWithOutbound"]>(
      async (input) => input.outbound
    ),
    outbounds: { create: vi.fn(), get: vi.fn(), getByIdempotencyKey: vi.fn() },
    outboundDelivery: {
      claim: vi.fn(),
      markDelivered: vi.fn(),
      markRetry: vi.fn(),
      markFailed: vi.fn()
    },
    scheduleAnchorBinder: {
      bind: vi.fn()
    } as unknown as BrainControlDispatcher["scheduleAnchorBinder"],
    scheduleService: {
      create: vi.fn(),
      list: vi.fn(),
      claimDue: vi.fn(),
      history: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      enable: vi.fn(),
      disable: vi.fn(),
      runNow: vi.fn()
    } as unknown as BrainControlDispatcher["scheduleService"],
    sessions: {
      create: vi.fn(),
      createAndBind: vi.fn(),
      activateBinding: vi.fn(),
      get: vi.fn(),
      getActiveBinding: vi.fn(),
      listRecent: vi.fn(),
      close: vi.fn(),
      touch: vi.fn()
    },
    retentionService: { run: vi.fn() } as unknown as BrainControlDispatcher["retentionService"],
    executions: {
      create: vi.fn(),
      get: vi.fn(),
      listBySchedule: vi.fn(),
      findActiveBySchedule: vi.fn(),
      update: vi.fn()
    },
    ids: { nextId: () => "id" },
    sessionRouting: {
      handleCommand: vi.fn()
    } as unknown as BrainControlDispatcher["sessionRouting"],
    preferences: { getVoiceReplies: vi.fn(), setVoiceReplies: vi.fn() },
    readJson: readJson as BrainControlDispatcher["readJson"],
    writeJson: writeJson as unknown as BrainControlDispatcher["writeJson"],
    ...overrides
  };
}

describe("dispatchBrainControlRequest", () => {
  const catalogDigest = `sha256:${"a".repeat(64)}`;
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores a transcript only for an audio message in the requested workspace", async () => {
    const audioMessage = {
      ...exampleInboundMessage,
      kind: "audio" as const,
      attachments: [{ ...exampleAttachment, mediaType: "audio/ogg" }]
    };
    const inboundMessages = {
      create: vi.fn(),
      get: vi.fn().mockResolvedValue(audioMessage),
      getByTransportEvent: vi.fn(),
      saveAudioTranscript: vi.fn().mockResolvedValue(undefined)
    };
    const dispatcher = makeDispatcher({
      inboundMessages,
      readJson: vi
        .fn()
        .mockResolvedValueOnce({
          workspaceId: audioMessage.workspaceId,
          text: "Remember the blue folder."
        })
        .mockResolvedValueOnce({ workspaceId: "workspace-other", text: "Wrong workspace" })
    });
    const response = noopResponse();
    const request = {
      method: "PUT",
      url: `/v1/inbound/${audioMessage.id}/audio-transcript`
    } as never;

    await dispatchBrainControlRequest(request, response, dispatcher);
    expect(inboundMessages.saveAudioTranscript).toHaveBeenCalledWith({
      id: audioMessage.id,
      workspaceId: audioMessage.workspaceId,
      text: "Remember the blue folder."
    });
    expect(dispatcher.writeJson).toHaveBeenCalledWith(response, 200, { stored: true });

    await dispatchBrainControlRequest(request, response, dispatcher);
    expect(dispatcher.writeJson).toHaveBeenLastCalledWith(response, 404, {
      error: "audio_message_not_found"
    });
    expect(inboundMessages.saveAudioTranscript).toHaveBeenCalledTimes(1);
  });

  it("returns 200 + 'live' for /health in ephemeral mode", async () => {
    const dispatcher = makeDispatcher({ catalogDigest });
    const response = noopResponse();
    await dispatchBrainControlRequest(
      { method: "GET", url: "/health" } as never,
      response,
      dispatcher
    );
    expect(dispatcher.writeJson).toHaveBeenCalledWith(
      response,
      200,
      expect.objectContaining({ status: "live", apiVersion: "1", catalogDigest, dependencies: [] })
    );
  });

  it("returns 404 for unknown routes", async () => {
    const dispatcher = makeDispatcher();
    const response = noopResponse();
    await dispatchBrainControlRequest(
      { method: "GET", url: "/v1/unknown" } as never,
      response,
      dispatcher
    );
    expect(dispatcher.writeJson).toHaveBeenCalledWith(response, 404, { error: "not_found" });
  });

  it("builds the registry with the historical optional dependency gates", () => {
    const base = makeDispatcher();
    expect(createBrainControlRouteRegistry(base)).toHaveLength(8);

    const withOptional = makeDispatcher({
      collaboration: {} as never,
      workspaceWriteLeases: {} as never,
      plannerDelegation: {} as never,
      workspaceResolution: {} as never,
      workspaceInvitation: {} as never,
      pluginBindings: {} as never,
      pluginCatalog: {} as never,
      brokerOperations: {} as never,
      approvalPrompts: {} as never,
      runAuthorizations: {} as never
    });
    expect(createBrainControlRouteRegistry(withOptional)).toHaveLength(13);
  });

  it("short-circuits at the first route that handles a request", async () => {
    const dispatcher = makeDispatcher();
    dispatcher.jobs.snapshot = vi.fn(async () => []);
    dispatcher.scheduleService.list = vi.fn(async () => []);
    dispatcher.sessions.listRecent = vi.fn(async () => []);
    const response = noopResponse();
    const routes = createBrainControlRouteRegistry(dispatcher);
    let handled = false;
    let attempted = 0;
    for (const route of routes) {
      attempted += 1;
      if (
        await route({
          request: { method: "GET", url: "/v1/admin/status" } as never,
          response,
          url: new URL("/v1/admin/status", "http://brain-control.local")
        })
      ) {
        handled = true;
        break;
      }
    }
    expect(handled).toBe(true);
    expect(attempted).toBe(4);
    expect(dispatcher.writeJson).toHaveBeenCalledTimes(1);
  });
});
