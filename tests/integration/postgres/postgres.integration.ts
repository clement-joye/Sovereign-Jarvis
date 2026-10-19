import {
  exampleAttachment,
  exampleInboundMessage,
  exampleJob,
  exampleOutboundMessage,
  exampleScheduledJob,
  type InternalJobV1,
  type OutboundMessageV1,
  type ScheduledJobV1
} from "@second-brain/contracts";
import {
  PostgresInboundAcceptanceService,
  PostgresInboundMessageRepository,
  PostgresJobQueue,
  PostgresOutboundCompletionService,
  PostgresOutboundDeliveryRepository,
  PostgresOutboundRepository,
  PostgresRetentionRepository,
  PostgresConversationPreferenceRepository,
  PostgresDurableAgentReferenceRepository,
  PostgresActionApprovalPolicyRepository,
  PostgresActionProposalRepository,
  PostgresScheduleClaimService,
  PostgresScheduleRepository,
  PostgresWorkspacePluginBindingRepository,
  PostgresWorkspaceRepository,
  PostgresWorkspaceWriteLeaseRepository
} from "@second-brain/postgres-adapter";
import { SequentialIdGenerator } from "@second-brain/testkit";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  resetDatabase,
  startPostgresIntegrationHarness,
  type PostgresIntegrationHarness
} from "./harness.js";

describe("PostgreSQL integration", () => {
  let harness: PostgresIntegrationHarness;
  let pool: Pool;

  beforeAll(async () => {
    harness = await startPostgresIntegrationHarness();
    pool = harness.pool;
  }, 120_000);

  beforeEach(async () => {
    await resetDatabase(pool);
  });

  afterAll(async () => {
    await harness?.stop();
  });

  it("applies the foundation migration to the real database", async () => {
    const result = await pool.query<{ schema_name: string }>(
      `
        SELECT schema_name
        FROM information_schema.schemata
        WHERE schema_name IN ('brain_core', 'brain_jobs', 'brain_audit')
        ORDER BY schema_name ASC
      `
    );

    expect(result.rows.map((row) => row.schema_name)).toEqual([
      "brain_audit",
      "brain_core",
      "brain_jobs"
    ]);
  });

  it("round-trips typed workspace, plugin, and conversation preference queries", async () => {
    const workspaces = new PostgresWorkspaceRepository(pool);
    const plugins = new PostgresWorkspacePluginBindingRepository(pool);
    const preferences = new PostgresConversationPreferenceRepository(pool);
    const now = new Date("2026-09-13T10:00:00.000Z");

    await workspaces.create({
      id: "workspace-typed",
      templateId: "second-brain",
      templateVersion: "1.0.0",
      configuration: { retentionDays: 7 },
      defaultAgent: "brain",
      status: "active",
      origin: "matrix_invite",
      createdAt: now,
      updatedAt: now,
      activatedAt: now
    });
    await workspaces.bindRoom({
      id: "binding-typed",
      workspaceId: "workspace-typed",
      roomId: "!typed:example",
      status: "active",
      createdAt: now
    });
    await plugins.upsert({
      workspaceId: "workspace-typed",
      pluginId: "calendar",
      pluginVersion: "1.0.0",
      enabledAgents: ["brain"],
      configuration: { calendarId: "primary" },
      updatedAt: now
    });
    await preferences.setVoiceReplies({
      workspaceId: "workspace-typed",
      conversationId: "!typed:example",
      enabled: true
    });

    await expect(workspaces.getActiveByRoomId("!typed:example")).resolves.toMatchObject({
      id: "workspace-typed",
      configuration: { retentionDays: 7 }
    });
    await expect(plugins.get("workspace-typed", "calendar")).resolves.toMatchObject({
      configuration: { calendarId: "primary" }
    });
    await expect(
      preferences.getVoiceReplies({
        workspaceId: "workspace-typed",
        conversationId: "!typed:example"
      })
    ).resolves.toBe(true);
  });

  it("collects typed durable agent references across union sources", async () => {
    const plugins = new PostgresWorkspacePluginBindingRepository(pool);
    await plugins.upsert({
      workspaceId: "workspace-example",
      pluginId: "agent-reference-test",
      pluginVersion: "1.0.0",
      enabledAgents: ["planner", "researcher"],
      configuration: {},
      updatedAt: new Date("2026-09-13T10:00:00.000Z")
    });

    await expect(
      new PostgresDurableAgentReferenceRepository(pool).listReferencedAgentIds()
    ).resolves.toEqual(["brain", "planner", "researcher"]);
  });

  it("atomically replaces typed action approval policies", async () => {
    const policies = new PostgresActionApprovalPolicyRepository(pool);
    const input = {
      workspaceId: "workspace-example",
      pluginId: "publishing-test",
      updatedAt: new Date("2026-09-13T10:00:00.000Z")
    };

    await policies.replaceOwnerRequiredOperations({
      ...input,
      operationIds: ["publish", "publish", "force-publish"]
    });

    await expect(policies.getMode(input.workspaceId, input.pluginId, "publish")).resolves.toBe(
      "owner"
    );
    await expect(
      policies.getMode(input.workspaceId, input.pluginId, "force-publish")
    ).resolves.toBe("owner");

    await policies.replaceOwnerRequiredOperations({ ...input, operationIds: [] });
    await expect(
      policies.getMode(input.workspaceId, input.pluginId, "publish")
    ).resolves.toBeUndefined();
  });

  it("preserves action proposal idempotency and compare-and-swap transitions", async () => {
    const now = new Date("2026-09-13T10:00:00.000Z");
    const expiresAt = new Date("2026-09-13T10:05:00.000Z");
    const digest = `sha256:${"a".repeat(64)}`;
    await pool.query(
      `INSERT INTO brain_core.agent_runs (
         id, workspace_id, agent_id, catalog_version, catalog_digest, status,
         root_run_id, deadline_at, timeout_seconds, token_budget, created_at
       ) VALUES ($1, 'workspace-example', 'brain', '1', $2, 'running', $1,
                 $3::timestamptz, 60, 1000, $4::timestamptz)`,
      ["run-proposal", digest, expiresAt.toISOString(), now.toISOString()]
    );
    const repository = new PostgresActionProposalRepository(pool);
    const proposal = {
      schemaVersion: 1 as const,
      id: "proposal-typed",
      operationDigest: digest,
      workspaceId: "workspace-example",
      agentId: "brain",
      runId: "run-proposal",
      pluginId: "publishing-test",
      capabilityId: "publishing",
      operationId: "publish",
      operationVersion: "1.0.0",
      summary: "Publish the reviewed item",
      parameters: { itemId: "item-1" },
      approvalMode: "owner" as const,
      requiredApprover: "owner" as const,
      idempotencyKey: "test-key-1",
      status: "proposed" as const,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString()
    };

    await expect(repository.createIfAbsent(proposal)).resolves.toEqual({
      proposal,
      created: true
    });
    await expect(repository.createIfAbsent({ ...proposal, id: "proposal-retry" })).resolves.toEqual(
      {
        proposal,
        created: false
      }
    );
    await expect(
      repository.forwardDecision({
        schemaVersion: 1,
        proposalId: proposal.id,
        workspaceId: proposal.workspaceId,
        ownerId: "owner-1",
        decision: "approve",
        decidedBy: "owner",
        decidedAt: new Date(now.getTime() + 60_000).toISOString(),
        externalEventId: "$approval"
      })
    ).resolves.toMatchObject({ id: proposal.id, status: "approved" });
    await expect(
      repository.consume({
        proposalId: proposal.id,
        workspaceId: proposal.workspaceId,
        agentId: proposal.agentId,
        runId: proposal.runId,
        pluginId: proposal.pluginId,
        capabilityId: proposal.capabilityId,
        operationId: proposal.operationId,
        operationVersion: proposal.operationVersion,
        operationDigest: proposal.operationDigest,
        idempotencyKey: proposal.idempotencyKey,
        now: new Date(now.getTime() + 120_000)
      })
    ).resolves.toMatchObject({ id: proposal.id, status: "consumed" });
    await expect(
      repository.consume({
        proposalId: proposal.id,
        workspaceId: proposal.workspaceId,
        agentId: proposal.agentId,
        runId: proposal.runId,
        pluginId: proposal.pluginId,
        capabilityId: proposal.capabilityId,
        operationId: proposal.operationId,
        operationVersion: proposal.operationVersion,
        operationDigest: proposal.operationDigest,
        idempotencyKey: proposal.idempotencyKey,
        now: new Date(now.getTime() + 120_000)
      })
    ).resolves.toBeUndefined();
  });

  it("preserves atomic typed workspace write-lease ownership", async () => {
    const now = new Date("2026-09-13T10:00:00.000Z");
    const digest = `sha256:${"b".repeat(64)}`;
    await pool.query(
      `INSERT INTO brain_core.agent_runs (
         id, workspace_id, agent_id, catalog_version, catalog_digest, status,
         root_run_id, deadline_at, timeout_seconds, token_budget, created_at
       ) VALUES
         ('lease-run-a', 'workspace-example', 'brain', '1', $1, 'running',
          'lease-run-a', $2::timestamptz, 60, 1000, $3::timestamptz),
         ('lease-run-b', 'workspace-example', 'brain', '1', $1, 'running',
          'lease-run-b', $2::timestamptz, 60, 1000, $3::timestamptz)`,
      [digest, new Date(now.getTime() + 300_000).toISOString(), now.toISOString()]
    );
    const repository = new PostgresWorkspaceWriteLeaseRepository(pool);
    const first = {
      schemaVersion: 1 as const,
      id: "lease-a",
      workspaceId: "workspace-example",
      ownerRunId: "lease-run-a",
      acquiredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString()
    };
    const second = {
      ...first,
      id: "lease-b",
      ownerRunId: "lease-run-b",
      acquiredAt: new Date(now.getTime() + 61_000).toISOString(),
      expiresAt: new Date(now.getTime() + 121_000).toISOString()
    };

    await expect(repository.acquire(first, now)).resolves.toEqual(first);
    await expect(repository.acquire(second, now)).resolves.toBeUndefined();
    await expect(repository.acquire(second, new Date(now.getTime() + 61_000))).resolves.toEqual(
      second
    );
    await expect(repository.get(first.workspaceId)).resolves.toEqual(second);
    await expect(
      repository.release({ workspaceId: first.workspaceId, ownerRunId: first.ownerRunId })
    ).resolves.toBe(false);
    await expect(
      repository.release({ workspaceId: second.workspaceId, ownerRunId: second.ownerRunId })
    ).resolves.toBe(true);
  });

  it("uses row locks so a second worker skips an uncommitted claimed job", async () => {
    const jobs = new PostgresJobQueue({ db: pool });
    await jobs.enqueue(makeJob("locked"));

    const firstClient = await pool.connect();
    try {
      await firstClient.query("BEGIN");
      const firstClaim = await new PostgresJobQueue({ db: firstClient }).claim({
        workerId: "worker-1",
        limit: 1,
        now: new Date("2026-07-18T10:00:00.000Z"),
        leaseMs: 30_000
      });

      expect(firstClaim).toHaveLength(1);

      const secondClaim = await jobs.claim({
        workerId: "worker-2",
        limit: 1,
        now: new Date("2026-07-18T10:00:00.000Z"),
        leaseMs: 30_000
      });

      expect(secondClaim).toEqual([]);
      await firstClient.query("ROLLBACK");
    } finally {
      firstClient.release();
    }

    const recoveredClaim = await jobs.claim({
      workerId: "worker-3",
      limit: 1,
      now: new Date("2026-07-18T10:00:01.000Z"),
      leaseMs: 30_000
    });

    expect(recoveredClaim).toMatchObject([{ id: "job-locked", leaseOwner: "worker-3" }]);
  });

  it("atomically admits one root, lets commands bypass capacity, and promotes the next root", async () => {
    const jobs = new PostgresJobQueue({ db: pool });
    await Promise.all([
      jobs.enqueue(
        makeJob("root-a", { payload: { inboundMessageId: "a", requiresRootAdmission: true } })
      ),
      jobs.enqueue(
        makeJob("root-b", {
          type: "run_schedule",
          payload: {
            scheduleId: "schedule-b",
            executionId: "execution-b",
            scheduledFor: "2026-07-18T09:58:00.000Z"
          }
        })
      )
    ]);
    const admission = { limit: 1, leaseMs: 90_000 };
    const now = new Date("2026-07-18T10:00:00.000Z");
    const [left, right] = await Promise.all([
      jobs.claim({
        workerId: "worker-a",
        limit: 1,
        now,
        leaseMs: 90_000,
        rootAdmission: admission
      }),
      jobs.claim({ workerId: "worker-b", limit: 1, now, leaseMs: 90_000, rootAdmission: admission })
    ]);
    const admitted = [...left, ...right];
    expect(admitted).toHaveLength(1);
    const heartbeatAt = new Date(now.getTime() + 30_000);
    await expect(
      jobs.renew({
        jobId: admitted[0]!.id,
        leaseOwner: admitted[0]!.leaseOwner!,
        now: heartbeatAt,
        leaseMs: 90_000,
        admissionLeaseMs: 90_000
      })
    ).resolves.toBe(true);
    await expect(jobs.admissionSnapshot(1, heartbeatAt)).resolves.toMatchObject({
      limit: 1,
      activeRoots: 1,
      roots: [{ rootRunId: admitted[0]!.id, heartbeatAt: heartbeatAt.toISOString() }]
    });

    const rootRunId = admitted[0]!.id;
    const digest = `sha256:${"a".repeat(64)}`;
    await pool.query(
      `INSERT INTO brain_core.agent_runs (
         id, workspace_id, agent_id, catalog_version, catalog_digest, status, parent_run_id, root_run_id,
         deadline_at, timeout_seconds, token_budget, created_at, started_at
       ) VALUES
         ($1, 'workspace-example', 'brain', '1', $3, 'running', NULL, $1,
          $4::timestamptz, 60, 1000, $2::timestamptz, $2::timestamptz),
         ('child-run', 'workspace-example', 'brain', '1', $3, 'queued', $1, $1,
          $4::timestamptz, 60, 1000, $2::timestamptz, NULL)`,
      [rootRunId, now.toISOString(), digest, new Date(now.getTime() + 60_000).toISOString()]
    );
    await jobs.enqueue(
      makeJob("child", {
        type: "run_agent",
        payload: { runId: "child-run", rootRunId },
        priority: 300
      })
    );
    const child = await jobs.claim({
      workerId: "worker-child",
      limit: 1,
      now,
      leaseMs: 90_000,
      jobTypes: ["run_agent"],
      rootAdmission: admission
    });
    expect(child).toMatchObject([{ id: "job-child" }]);
    await jobs.enqueue(
      makeJob("command", {
        priority: 200,
        payload: { inboundMessageId: "command", requiresRootAdmission: false }
      })
    );
    await expect(
      jobs.claim({
        workerId: "worker-command",
        limit: 1,
        now,
        leaseMs: 90_000,
        rootAdmission: admission
      })
    ).resolves.toMatchObject([{ id: "job-command" }]);
    await jobs.complete({ jobId: "job-command", leaseOwner: "worker-command" });

    await pool.query(
      `UPDATE brain_core.agent_runs
       SET status = 'completed', completed_at = $2::timestamptz
       WHERE id = $1`,
      [rootRunId, new Date(now.getTime() + 500).toISOString()]
    );
    await jobs.complete({ jobId: admitted[0]!.id, leaseOwner: admitted[0]!.leaseOwner! });
    await expect(jobs.admissionSnapshot(1, now)).resolves.toMatchObject({ activeRoots: 1 });
    await pool.query(
      `UPDATE brain_core.agent_runs
       SET status = 'completed', completed_at = $1::timestamptz
       WHERE id = 'child-run'`,
      [new Date(now.getTime() + 750).toISOString()]
    );
    await jobs.complete({ jobId: "job-child", leaseOwner: "worker-child" });
    await expect(jobs.admissionSnapshot(1, now)).resolves.toMatchObject({ activeRoots: 0 });
    const restartedJobs = new PostgresJobQueue({ db: pool });
    const promoted = await restartedJobs.claim({
      workerId: "worker-next",
      limit: 1,
      now: new Date("2026-07-18T10:00:01.000Z"),
      leaseMs: 90_000,
      rootAdmission: admission
    });
    expect(promoted).toMatchObject([
      {
        id: "job-root-b",
        type: "run_schedule",
        attempts: 0,
        payload: { scheduledFor: "2026-07-18T09:58:00.000Z" }
      }
    ]);
    await expect(
      restartedJobs.claim({
        workerId: "worker-recovery",
        limit: 1,
        now: new Date("2026-07-18T10:01:32.000Z"),
        leaseMs: 90_000,
        rootAdmission: admission
      })
    ).resolves.toMatchObject([{ id: promoted[0]!.id, leaseOwner: "worker-recovery", attempts: 0 }]);
    await expect(
      restartedJobs.fail({
        jobId: promoted[0]!.id,
        leaseOwner: "worker-recovery",
        now: new Date("2026-07-18T10:01:32.500Z"),
        retryable: true,
        retryDelayMs: 60_000,
        maxAttempts: 3,
        reason: "temporary_runtime_failure"
      })
    ).resolves.toMatchObject({ status: "retry_wait", attempts: 1 });

    await restartedJobs.enqueue(makeJob("queued-cancel"));
    await expect(
      restartedJobs.cancelRootRun({
        rootRunId: "job-queued-cancel",
        now: new Date("2026-07-18T10:01:33.000Z"),
        reason: "cancelled_by_control"
      })
    ).resolves.toBe(1);
    await restartedJobs.enqueue(makeJob("root-c"));
    await expect(
      restartedJobs.claim({
        workerId: "worker-after-retry",
        limit: 1,
        now: new Date("2026-07-18T10:01:33.000Z"),
        leaseMs: 90_000,
        rootAdmission: admission
      })
    ).resolves.toMatchObject([{ id: "job-root-c", attempts: 0 }]);
    await expect(restartedJobs.snapshot()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "job-queued-cancel", status: "cancelled" })
      ])
    );
  });

  it("accepts duplicate inbound events once using real unique constraints", async () => {
    const service = new PostgresInboundAcceptanceService({
      db: pool,
      ids: new SequentialIdGenerator(),
      now: () => new Date("2026-07-18T10:00:00.000Z")
    });
    const inbound = {
      ...exampleInboundMessage,
      id: "inbound-duplicate",
      externalEventId: "$duplicate-event",
      traceId: "trace-duplicate"
    };

    const first = await service.acceptMatrixInbound(inbound);
    const second = await service.acceptMatrixInbound({
      ...inbound,
      id: "inbound-duplicate-replay",
      traceId: "trace-duplicate-replay"
    });
    const jobs = await new PostgresJobQueue({ db: pool }).snapshot();

    expect(first).toMatchObject({ inboundMessageId: "inbound-duplicate", duplicate: false });
    expect(second).toMatchObject({ inboundMessageId: "inbound-duplicate", duplicate: true });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload).toMatchObject({
      inboundMessageId: "inbound-duplicate",
      agentId: "brain"
    });
  });

  it("targets only the leased inbound turn in the same Matrix thread for /cancel", async () => {
    const now = new Date();
    const service = new PostgresInboundAcceptanceService({
      db: pool,
      ids: new SequentialIdGenerator(),
      now: () => now
    });
    const jobs = new PostgresJobQueue({ db: pool });
    const active = await service.acceptMatrixInbound({
      ...exampleInboundMessage,
      id: "inbound-active",
      externalEventId: "$active",
      threadRootExternalEventId: "$thread-a",
      text: "Tell me more."
    });
    await jobs.claim({
      workerId: "worker-a",
      limit: 1,
      now,
      leaseMs: 60_000
    });

    const otherThread = await service.acceptMatrixInbound({
      ...exampleInboundMessage,
      id: "inbound-other-cancel",
      externalEventId: "$cancel-other",
      threadRootExternalEventId: "$thread-b",
      text: "/cancel"
    });
    const sameThread = await service.acceptMatrixInbound({
      ...exampleInboundMessage,
      id: "inbound-cancel",
      externalEventId: "$cancel",
      threadRootExternalEventId: "$thread-a",
      text: "/cancel"
    });

    expect(otherThread.cancelTargetRunId).toBeUndefined();
    expect(sameThread.cancelTargetRunId).toBe(active.jobId);
    expect(sameThread.cancelTargetNeedsPiCancel).toBe(true);
    expect(
      (await jobs.snapshot()).find((job) => job.id === sameThread.jobId)?.payload
    ).toMatchObject({
      cancelTargetRunId: active.jobId
    });
  });

  it("cancels a queued turn before it can start when /cancel arrives in its thread", async () => {
    const now = new Date();
    const service = new PostgresInboundAcceptanceService({
      db: pool,
      ids: new SequentialIdGenerator(),
      now: () => now
    });
    const jobs = new PostgresJobQueue({ db: pool });
    const queued = await service.acceptMatrixInbound({
      ...exampleInboundMessage,
      id: "inbound-queued",
      externalEventId: "$queued",
      threadRootExternalEventId: "$thread-queued",
      text: "How are you?"
    });
    const cancellation = await service.acceptMatrixInbound({
      ...exampleInboundMessage,
      id: "inbound-queued-cancel",
      externalEventId: "$queued-cancel",
      threadRootExternalEventId: "$thread-queued",
      text: "/cancel"
    });

    expect(cancellation).toMatchObject({
      cancelTargetRunId: queued.jobId,
      cancelTargetNeedsPiCancel: false
    });
    const snapshot = await jobs.snapshot();
    expect(snapshot.find((job) => job.id === queued.jobId)?.status).toBe("cancelled");
    expect(snapshot.find((job) => job.id === cancellation.jobId)?.payload).toMatchObject({
      cancelTargetRunId: queued.jobId,
      cancelTargetNeedsPiCancel: false
    });
    const claimed = await jobs.claim({ workerId: "cancel-test", limit: 5, now, leaseMs: 60_000 });
    expect(claimed.map((job) => job.id)).not.toContain(queued.jobId);
  });

  it("returns bounded typed thread history in chronological order", async () => {
    const inbound = new PostgresInboundMessageRepository({ db: pool });
    const outbounds = new PostgresOutboundRepository({ db: pool });
    const root = {
      ...exampleInboundMessage,
      id: "history-root",
      externalEventId: "$history-root",
      text: "First",
      receivedAt: "2026-07-18T09:58:00.000Z"
    };
    const current = {
      ...exampleInboundMessage,
      id: "history-current",
      externalEventId: "$history-current",
      threadRootExternalEventId: "$history-root",
      text: "Current",
      receivedAt: "2026-07-18T10:00:00.000Z"
    };
    await inbound.create(root);
    await inbound.create(current);
    await outbounds.create({
      ...makeOutbound("history"),
      conversationId: current.conversationId,
      threadRootExternalEventId: "$history-root",
      text: "Second"
    });
    await outbounds.create({
      ...makeOutbound("history-notice"),
      conversationId: current.conversationId,
      threadRootExternalEventId: "$history-root",
      presentation: "notice",
      text: "Delegating to Browser…"
    });

    await expect(inbound.listThreadHistory({ message: current, limit: 10 })).resolves.toMatchObject(
      [
        { sender: "user", text: "First" },
        { sender: "jarvis", text: "Second" }
      ]
    );
  });

  it("includes a stored voice transcript in later thread context", async () => {
    const inbound = new PostgresInboundMessageRepository({ db: pool });
    const voice = {
      ...exampleInboundMessage,
      id: "voice-history-root",
      externalEventId: "$voice-history-root",
      kind: "audio" as const,
      text: undefined,
      attachments: [{ ...exampleAttachment, id: "voice-history-audio", mediaType: "audio/ogg" }]
    };
    const current = {
      ...exampleInboundMessage,
      id: "voice-history-current",
      externalEventId: "$voice-history-current",
      threadRootExternalEventId: voice.externalEventId,
      text: "What did I say?"
    };
    await inbound.create(voice);
    await inbound.saveAudioTranscript({
      id: voice.id,
      workspaceId: voice.workspaceId!,
      text: "Remember the blue folder."
    });
    await inbound.create(current);

    await expect(inbound.listThreadHistory({ message: current, limit: 10 })).resolves.toEqual([
      {
        sender: "user",
        text: "[Voice transcript] Remember the blue folder.",
        occurredAt: voice.receivedAt
      }
    ]);
    await expect(
      inbound.saveAudioTranscript({
        id: voice.id,
        workspaceId: "workspace-other",
        text: "Wrong workspace"
      })
    ).rejects.toThrow("Audio message was not found");

    const retention = new PostgresRetentionRepository({ db: pool, retentionMs: 604_800_000 });
    await retention.sanitize({
      record: {
        id: `inbound_message:${voice.workspaceId}:${voice.id}`,
        workspaceId: voice.workspaceId!,
        targetType: "inbound_message",
        targetId: voice.id,
        eligibleAt: new Date(voice.receivedAt),
        reason: "expired"
      },
      now: new Date()
    });
    await expect(inbound.listThreadHistory({ message: current, limit: 10 })).resolves.toEqual([]);
  });

  it("rolls back outbound creation when job completion fails", async () => {
    const jobs = new PostgresJobQueue({ db: pool });
    const outbounds = new PostgresOutboundRepository({ db: pool });
    const completion = new PostgresOutboundCompletionService({ db: pool });

    await jobs.enqueue(makeJob("rollback"));
    await jobs.claim({
      workerId: "worker-owner",
      limit: 1,
      now: new Date("2026-07-18T10:00:00.000Z"),
      leaseMs: 30_000
    });

    await expect(
      completion.createOutboundAndComplete({
        outbound: makeOutbound("rollback"),
        jobId: "job-rollback",
        leaseOwner: "wrong-owner"
      })
    ).rejects.toThrow(/active lease owner/);

    await expect(outbounds.get("outbound-rollback")).resolves.toBeUndefined();
    await expect(jobs.snapshot()).resolves.toMatchObject([
      { id: "job-rollback", status: "leased", leaseOwner: "worker-owner" }
    ]);
  });

  it("records typed delivery attempts and updates outbound delivery state", async () => {
    const outbounds = new PostgresOutboundRepository({ db: pool });
    const deliveries = new PostgresOutboundDeliveryRepository({ db: pool });
    const outbound = makeOutbound("delivery");
    await outbounds.create(outbound);

    const retryAt = new Date("2026-07-18T10:00:00.000Z");
    await deliveries.markRetry({
      outboundMessageId: outbound.id,
      transport: "matrix",
      now: retryAt,
      error: {
        schemaVersion: 1,
        code: "matrix_unavailable",
        category: "dependency",
        message: "Matrix is unavailable.",
        retryable: true
      }
    });
    const deliveredAt = new Date("2026-07-18T10:01:00.000Z");
    await deliveries.markDelivered({
      outboundMessageId: outbound.id,
      transport: "matrix",
      externalEventId: "$delivered",
      now: deliveredAt
    });

    const message = await pool.query<{ status: string; delivered_at: Date }>(
      `SELECT status, delivered_at FROM brain_core.outbound_messages WHERE id = $1`,
      [outbound.id]
    );
    const attempts = await pool.query<{
      workspace_id: string;
      status: string;
      error: Record<string, unknown> | null;
    }>(
      `SELECT workspace_id, status, error
       FROM brain_core.delivery_attempts
       WHERE outbound_message_id = $1
       ORDER BY attempted_at`,
      [outbound.id]
    );
    expect(message.rows[0]).toMatchObject({ status: "delivered", delivered_at: deliveredAt });
    expect(attempts.rows).toMatchObject([
      {
        workspace_id: "workspace-example",
        status: "retry_wait",
        error: { code: "matrix_unavailable" }
      },
      { workspace_id: "workspace-example", status: "delivered", error: null }
    ]);
  });

  it("claims a due schedule once when schedulers race", async () => {
    const schedules = new PostgresScheduleRepository({ db: pool });
    await schedules.create(makeSchedule("race"));

    const ids = new SequentialIdGenerator();
    const [firstClaim, secondClaim] = await Promise.all([
      new PostgresScheduleClaimService({ db: pool, ids }).claimDue({
        now: new Date("2026-07-18T10:00:00.000Z"),
        limit: 1
      }),
      new PostgresScheduleClaimService({ db: pool, ids }).claimDue({
        now: new Date("2026-07-18T10:00:00.000Z"),
        limit: 1
      })
    ]);

    const claimed = [...firstClaim, ...secondClaim];
    const jobs = await new PostgresJobQueue({ db: pool }).snapshot();

    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ scheduleId: "schedule-race", status: "queued" });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.type).toBe("run_schedule");
  });

  it("persists a schedule's Matrix thread destination through updates", async () => {
    const schedules = new PostgresScheduleRepository({ db: pool });
    const created = await schedules.create({
      ...makeSchedule("thread-destination"),
      destinationThreadRootExternalEventId: "$thread:example"
    });
    expect(created.destinationThreadRootExternalEventId).toBe("$thread:example");

    const updated = await schedules.update(
      { ...created, name: "Updated thread destination", version: 2 },
      1
    );
    expect(updated.destinationThreadRootExternalEventId).toBe("$thread:example");
    expect((await schedules.get(updated.id))?.destinationThreadRootExternalEventId).toBe(
      "$thread:example"
    );
  });
});

function makeJob(suffix: string, overrides: Partial<InternalJobV1> = {}): InternalJobV1 {
  return {
    ...exampleJob,
    id: `job-${suffix}`,
    idempotencyKey: `job:${suffix}`,
    payload: { inboundMessageId: `inbound-${suffix}` },
    availableAt: "2026-07-18T09:59:00.000Z",
    ...overrides
  };
}

function makeOutbound(suffix: string): OutboundMessageV1 {
  return {
    ...exampleOutboundMessage,
    id: `outbound-${suffix}`,
    traceId: `trace-${suffix}`,
    idempotencyKey: `outbound:${suffix}`
  };
}

function makeSchedule(suffix: string): ScheduledJobV1 {
  return {
    ...exampleScheduledJob,
    id: `schedule-${suffix}`,
    name: `Schedule ${suffix}`,
    nextRunAt: "2026-07-18T09:59:00.000Z",
    createdAt: "2026-07-18T09:00:00.000Z",
    updatedAt: "2026-07-18T09:00:00.000Z"
  };
}
