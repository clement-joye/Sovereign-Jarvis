import { describe, expect, it } from "vitest";

import { exampleOutboundMessage, type ActionProposalV1 } from "@second-brain/contracts";

import {
  InMemoryActionApprovalPolicyRepository,
  InMemoryActionProposalRepository,
  InMemoryConversationPreferenceRepository,
  InMemoryOutboundDeliveryRepository,
  InMemoryOutboundRepository,
  InMemoryRetentionRepository
} from "./fakes.js";

const proposal = (overrides: Partial<ActionProposalV1> = {}) => ({
  schemaVersion: 1 as const,
  id: "proposal-1",
  operationDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  workspaceId: "workspace-1",
  agentId: "pi",
  runId: "run-1",
  pluginId: "plugin.git",
  capabilityId: "git",
  operationId: "push",
  operationVersion: "1.0.0",
  summary: "Push changes",
  parameters: { branch: "main" },
  approvalMode: "owner" as const,
  requiredApprover: "owner" as const,
  idempotencyKey: "idem-1",
  status: "proposed" as const,
  createdAt: "2026-08-29T12:00:00.000Z",
  expiresAt: "2026-08-29T12:05:00.000Z",
  ...overrides
});

describe("in-memory development adapters", () => {
  it("stores only owner-strengthening policy rows and replaces one plugin scope", async () => {
    const repository = new InMemoryActionApprovalPolicyRepository();
    const updatedAt = new Date("2026-08-29T12:00:00.000Z");

    await expect(repository.getMode("workspace-1", "plugin.git", "push")).resolves.toBeUndefined();
    await repository.replaceOwnerRequiredOperations({
      workspaceId: "workspace-1",
      pluginId: "plugin.git",
      operationIds: ["push", "push", "pull"],
      updatedAt
    });
    await expect(repository.getMode("workspace-1", "plugin.git", "push")).resolves.toBe("owner");
    await expect(repository.getMode("workspace-1", "plugin.git", "pull")).resolves.toBe("owner");
    await expect(
      repository.getMode("workspace-1", "plugin.git", "status")
    ).resolves.toBeUndefined();

    await repository.replaceOwnerRequiredOperations({
      workspaceId: "workspace-1",
      pluginId: "plugin.git",
      operationIds: ["status"],
      updatedAt
    });
    await expect(repository.getMode("workspace-1", "plugin.git", "push")).resolves.toBeUndefined();
    await expect(repository.getMode("workspace-1", "plugin.git", "status")).resolves.toBe("owner");
    await expect(
      repository.getMode("workspace-2", "plugin.git", "status")
    ).resolves.toBeUndefined();
  });

  it("enforces idempotent proposals and exact consume binding", async () => {
    const repository = new InMemoryActionProposalRepository();
    const first = proposal();
    await expect(repository.createIfAbsent(first)).resolves.toEqual({
      proposal: first,
      created: true
    });
    await expect(repository.createIfAbsent({ ...first, id: "proposal-retry" })).resolves.toEqual({
      proposal: first,
      created: false
    });

    await expect(
      repository.forwardDecision({
        schemaVersion: 1,
        workspaceId: first.workspaceId,
        ownerId: "owner-1",
        proposalId: first.id,
        decision: "approve",
        decidedBy: "owner",
        decidedAt: "2026-08-29T12:01:00.000Z",
        externalEventId: "$decision-1"
      })
    ).resolves.toMatchObject({ status: "approved" });
    await expect(
      repository.consume({
        proposalId: first.id,
        workspaceId: first.workspaceId,
        agentId: first.agentId,
        runId: first.runId,
        pluginId: first.pluginId,
        capabilityId: first.capabilityId,
        operationId: first.operationId,
        operationVersion: first.operationVersion,
        operationDigest: first.operationDigest,
        idempotencyKey: first.idempotencyKey,
        now: new Date("2026-08-29T12:02:00.000Z")
      })
    ).resolves.toMatchObject({ status: "consumed" });
    await expect(
      repository.consume({
        proposalId: first.id,
        workspaceId: first.workspaceId,
        agentId: first.agentId,
        runId: first.runId,
        pluginId: first.pluginId,
        capabilityId: first.capabilityId,
        operationId: first.operationId,
        operationVersion: first.operationVersion,
        operationDigest: first.operationDigest,
        idempotencyKey: "wrong",
        now: new Date("2026-08-29T12:02:00.000Z")
      })
    ).resolves.toBeUndefined();
  });

  it("rejects replayed decision events and expires before transitions", async () => {
    const repository = new InMemoryActionProposalRepository();
    const first = proposal();
    await repository.createIfAbsent(first);
    await expect(
      repository.forwardDecision({
        schemaVersion: 1,
        workspaceId: first.workspaceId,
        ownerId: "owner-1",
        proposalId: first.id,
        decision: "approve",
        decidedBy: "owner",
        decidedAt: "2026-08-29T12:01:00.000Z",
        externalEventId: "$decision-1"
      })
    ).resolves.toMatchObject({ status: "approved" });
    await expect(
      repository.forwardDecision({
        schemaVersion: 1,
        workspaceId: first.workspaceId,
        ownerId: "owner-1",
        proposalId: "proposal-other",
        decision: "approve",
        decidedBy: "owner",
        decidedAt: "2026-08-29T12:01:00.000Z",
        externalEventId: "$decision-1"
      })
    ).resolves.toBeUndefined();

    const expiring = proposal({ id: "proposal-2", idempotencyKey: "idem-2" });
    await repository.createIfAbsent(expiring);
    await expect(
      repository.markExpired({ proposalId: expiring.id, now: new Date("2026-08-29T12:05:00.000Z") })
    ).resolves.toMatchObject({
      status: "expired"
    });
    await expect(
      repository.forwardDecision({
        schemaVersion: 1,
        workspaceId: expiring.workspaceId,
        ownerId: "owner-1",
        proposalId: expiring.id,
        decision: "reject",
        decidedBy: "owner",
        decidedAt: "2026-08-29T12:05:00.000Z",
        externalEventId: "$decision-expired"
      })
    ).resolves.toBeUndefined();
  });

  it("does not evict active proposals at its bound", async () => {
    const repository = new InMemoryActionProposalRepository({ maxRecords: 1 });
    await repository.createIfAbsent(proposal());
    await expect(
      repository.createIfAbsent(proposal({ id: "proposal-2", idempotencyKey: "idem-2" }))
    ).rejects.toThrow("capacity exhausted");
  });

  it("tracks outbound delivery state", async () => {
    const outbounds = new InMemoryOutboundRepository();
    const delivery = new InMemoryOutboundDeliveryRepository(outbounds);
    const message = { ...exampleOutboundMessage, id: "outbound-1", idempotencyKey: "key-1" };
    await outbounds.create(message);

    await expect(
      delivery.claim({ transport: "matrix", now: new Date("2026-07-26T00:00:00.000Z"), limit: 1 })
    ).resolves.toEqual([message]);
    await expect(
      delivery.markDelivered({
        outboundMessageId: message.id,
        transport: "matrix",
        externalEventId: "$event-1",
        now: new Date("2026-07-26T00:00:01.000Z")
      })
    ).resolves.toMatchObject({ status: "delivered", externalEventId: "$event-1" });
    await expect(
      delivery.claim({ transport: "matrix", now: new Date("2026-07-26T00:00:02.000Z"), limit: 1 })
    ).resolves.toEqual([]);
  });

  it("stores conversation preferences by conversation and thread", async () => {
    const preferences = new InMemoryConversationPreferenceRepository();

    await preferences.setVoiceReplies({
      conversationId: "room-1",
      threadRootExternalEventId: "$thread-1",
      enabled: true
    });

    await expect(
      preferences.getVoiceReplies({
        conversationId: "room-1",
        threadRootExternalEventId: "$thread-1"
      })
    ).resolves.toBe(true);
    await expect(preferences.getVoiceReplies({ conversationId: "room-1" })).resolves.toBe(false);
  });

  it("removes sanitized eligible retention records", async () => {
    const repository = new InMemoryRetentionRepository();
    const record = {
      id: "record-1",
      workspaceId: "workspace-example",
      targetType: "pi_session" as const,
      targetId: "session-1",
      eligibleAt: new Date("2026-07-25T00:00:00.000Z"),
      reason: "test retention"
    };
    repository.add(record);

    await expect(
      repository.listEligible({ now: new Date("2026-07-26T00:00:00.000Z"), limit: 10 })
    ).resolves.toEqual([record]);
    await repository.sanitize({ record, now: new Date("2026-07-26T00:00:00.000Z") });
    await expect(
      repository.listEligible({ now: new Date("2026-07-26T00:00:00.000Z"), limit: 10 })
    ).resolves.toEqual([]);
  });
});
