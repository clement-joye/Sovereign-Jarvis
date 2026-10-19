import { describe, expect, it } from "vitest";

import {
  InMemoryConversationPreferenceRepository,
  InMemoryActionProposalRepository,
  InMemoryExecutionRepository,
  InMemoryInboundMessageRepository,
  InMemoryJobQueue,
  InMemoryOutboundDeliveryRepository,
  InMemoryOutboundRepository,
  InMemoryRetentionRepository,
  InMemoryScheduleRepository,
  InMemorySessionRepository,
  InMemoryWorkspaceRepository
} from "@second-brain/testkit";

import {
  createExecutions,
  createActionProposals,
  createInboundAcceptance,
  createInboundMessages,
  createJobQueue,
  createOutboundDelivery,
  createOutbounds,
  createPreferences,
  createRetentionRepository,
  createScheduleClaims,
  createSchedules,
  createSessions,
  createWorkspaces
} from "./repository-factories.js";
import { createBrainControlRepositoryGraph } from "./composition-repositories.js";

describe("repository factories (ephemeral mode)", () => {
  it("returns in-memory implementations when no pool is configured", () => {
    expect(createJobQueue(undefined)).toBeInstanceOf(InMemoryJobQueue);
    expect(createActionProposals(undefined)).toBeInstanceOf(InMemoryActionProposalRepository);
    expect(createInboundMessages(undefined)).toBeInstanceOf(InMemoryInboundMessageRepository);
    expect(createSessions(undefined)).toBeInstanceOf(InMemorySessionRepository);
    expect(createWorkspaces(undefined)).toBeInstanceOf(InMemoryWorkspaceRepository);
    expect(createPreferences(undefined)).toBeInstanceOf(InMemoryConversationPreferenceRepository);
    expect(createSchedules(undefined)).toBeInstanceOf(InMemoryScheduleRepository);
    expect(createExecutions(undefined)).toBeInstanceOf(InMemoryExecutionRepository);
    expect(createScheduleClaims(undefined, { nextId: () => "id" })).toBeUndefined();
    expect(createOutbounds(undefined)).toBeInstanceOf(InMemoryOutboundRepository);
  });

  it("returns an in-memory retention repository with no extra options", () => {
    expect(
      createRetentionRepository(undefined, { retentionMs: 1000, maxRetentionMs: 2000 })
    ).toBeInstanceOf(InMemoryRetentionRepository);
  });

  it("wires the in-memory outbound delivery against the in-memory outbound repository", () => {
    const outbounds = createOutbounds(undefined);
    expect(createOutboundDelivery(undefined, outbounds)).toBeInstanceOf(
      InMemoryOutboundDeliveryRepository
    );
  });

  it("uses the in-memory inbound acceptance service when no pool is configured", () => {
    const inboundMessages = createInboundMessages(undefined);
    const jobs = createJobQueue(undefined);
    const ids = { nextId: (prefix: string) => `${prefix}-test` };
    const acceptance = createInboundAcceptance(undefined, ids, inboundMessages, jobs);
    expect(acceptance).toBeDefined();
  });

  it("builds one coherent in-memory repository graph", () => {
    const graph = createBrainControlRepositoryGraph({
      postgresPool: undefined,
      ids: { nextId: (prefix) => `${prefix}-test` },
      retentionMs: 1_000,
      maxRetentionMs: 2_000
    });
    expect(graph.jobs).toBeInstanceOf(InMemoryJobQueue);
    expect(graph.inboundMessages).toBeInstanceOf(InMemoryInboundMessageRepository);
    expect(graph.outbounds).toBeInstanceOf(InMemoryOutboundRepository);
    expect(graph.outboundDelivery).toBeInstanceOf(InMemoryOutboundDeliveryRepository);
    expect(graph.retentionRecords).toBeInstanceOf(InMemoryRetentionRepository);
    expect(graph.inboundAcceptance).toBeDefined();
  });
});
