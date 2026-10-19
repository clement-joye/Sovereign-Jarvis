import { describe, expect, it, vi } from "vitest";

import {
  ConversationSessionHandler,
  ScheduleCommandHandler,
  SessionLifecycleCommandHandler,
  SessionOverviewCommandHandler,
  SessionRecordFactory,
  VoicePreferenceCommandHandler
} from "@second-brain/application";
import { INITIAL_AGENT_CATALOG } from "@second-brain/domain";

import { createApplicationServices } from "./service-factories.js";

function buildHandlers() {
  return {
    voicePreferences: new VoicePreferenceCommandHandler(undefined),
    scheduleCommands: new ScheduleCommandHandler(undefined, { now: () => new Date() }, "UTC"),
    lifecycleCommands: new SessionLifecycleCommandHandler(
      stubSessionRepository(),
      { now: () => new Date() },
      async () => undefined
    ),
    overviewCommands: new SessionOverviewCommandHandler(
      stubSessionRepository(),
      new SessionRecordFactory(
        { now: () => new Date() },
        { nextId: () => "id" },
        { idleContinuationMs: 1, retentionMs: 1 }
      ),
      () => new Date(),
      async () => undefined
    ),
    conversations: new ConversationSessionHandler(
      stubSessionRepository(),
      { now: () => new Date() },
      { nextId: () => "id" },
      { idleContinuationMs: 1, retentionMs: 1 }
    )
  };
}

function stubSessionRepository() {
  return {
    create: vi.fn(),
    createAndBind: vi.fn(),
    activateBinding: vi.fn(),
    get: vi.fn(),
    getActiveBinding: vi.fn(),
    listRecent: vi.fn(),
    close: vi.fn(),
    touch: vi.fn()
  };
}

describe("createApplicationServices", () => {
  it("wires every service from a flat dependency bundle", () => {
    const dependencies = {
      sessions: stubSessionRepository(),
      preferences: undefined,
      schedules: undefined,
      executions: {
        create: vi.fn(),
        get: vi.fn(),
        listBySchedule: vi.fn(),
        findActiveBySchedule: vi.fn(),
        update: vi.fn()
      },
      jobs: { enqueue: vi.fn(), claim: vi.fn(), complete: vi.fn(), fail: vi.fn() },
      scheduleClaims: undefined,
      retentionRecords: { listEligible: vi.fn(), tombstone: vi.fn(), sanitize: vi.fn() },
      attachments: {
        put: vi.fn(),
        open: vi.fn(),
        stat: vi.fn(),
        delete: vi.fn(),
        listOrphans: vi.fn()
      },
      outboundDelivery: {
        claim: vi.fn(),
        markDelivered: vi.fn(),
        markRetry: vi.fn(),
        markFailed: vi.fn()
      },
      clock: { now: () => new Date() },
      ids: { nextId: () => "id" },
      agentCatalog: INITIAL_AGENT_CATALOG,
      config: {
        sessionIdleContinuationMs: 1_000,
        sessionRetentionMs: 2_000,
        scheduleDisplayTimezone: "UTC"
      },
      ...buildHandlers()
    };
    const services = createApplicationServices(dependencies);

    expect(services.sessionRouting).toBeDefined();
    expect(services.scheduleService).toBeDefined();
    expect(services.retentionService).toBeDefined();
    expect(services.outboundDelivery).toBe(dependencies.outboundDelivery);
  });

  it("forwards the optional approval command handler to session routing", async () => {
    const approvalCommands = { handle: vi.fn().mockResolvedValue("approval handled") };
    const dependencies = {
      sessions: stubSessionRepository(),
      preferences: undefined,
      schedules: undefined,
      executions: {
        create: vi.fn(),
        get: vi.fn(),
        listBySchedule: vi.fn(),
        findActiveBySchedule: vi.fn(),
        update: vi.fn()
      },
      jobs: { enqueue: vi.fn(), claim: vi.fn(), complete: vi.fn(), fail: vi.fn() },
      scheduleClaims: undefined,
      retentionRecords: { listEligible: vi.fn(), tombstone: vi.fn(), sanitize: vi.fn() },
      attachments: {
        put: vi.fn(),
        open: vi.fn(),
        stat: vi.fn(),
        delete: vi.fn(),
        listOrphans: vi.fn()
      },
      outboundDelivery: {
        claim: vi.fn(),
        markDelivered: vi.fn(),
        markRetry: vi.fn(),
        markFailed: vi.fn()
      },
      clock: { now: () => new Date("2026-07-17T15:00:00.000Z") },
      ids: { nextId: () => "id" },
      agentCatalog: INITIAL_AGENT_CATALOG,
      config: {
        sessionIdleContinuationMs: 1_000,
        sessionRetentionMs: 2_000,
        scheduleDisplayTimezone: "UTC"
      },
      ...buildHandlers(),
      approvalCommands
    };

    const services = createApplicationServices(dependencies);
    const result = await services.sessionRouting.routeInbound({
      schemaVersion: 1,
      id: "inbound-approval",
      traceId: "trace-approval",
      transport: "matrix",
      externalEventId: "$approval",
      conversationId: "!room:example",
      workspaceId: "workspace-1",
      senderId: "@owner:example",
      receivedAt: "2026-07-17T15:00:00.000Z",
      kind: "command",
      text: "/approve proposal-1",
      attachments: [],
      metadata: {}
    });

    expect(result).toMatchObject({ kind: "command-response", command: "approve" });
    expect(approvalCommands.handle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "inbound-approval" }),
      { type: "approve", proposalId: "proposal-1" }
    );
  });
});
