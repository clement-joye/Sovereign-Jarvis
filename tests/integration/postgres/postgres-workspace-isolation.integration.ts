/**
 * Cross-workspace isolation contract for the Postgres-backed application
 * services. Phase 2 of the v2 plan requires that equivalent records in two
 * workspaces cannot cross-read or cross-write. The unit-level deterministic
 * suite covers the in-memory implementation; this file proves the same
 * invariant against the real schema, including the workspace-scoped unique
 * constraints defined by the public database baseline.
 */
import {
  exampleInboundMessage,
  exampleOutboundMessage,
  exampleScheduledJob,
  type InboundMessageV1,
  type OutboundMessageV1,
  type ScheduledJobV1
} from "@second-brain/contracts";
import {
  PostgresExecutionRepository,
  PostgresJobQueue,
  PostgresOutboundRepository,
  PostgresScheduleRepository,
  PostgresSessionRepository
} from "@second-brain/postgres-adapter";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  resetDatabase,
  startPostgresIntegrationHarness,
  type PostgresIntegrationHarness
} from "./harness.js";

let harness: PostgresIntegrationHarness;
let pool: Pool;

beforeAll(async () => {
  harness = await startPostgresIntegrationHarness();
  pool = harness.pool;
}, 120_000);

afterAll(async () => {
  await harness?.stop();
});

beforeEach(async () => {
  await resetDatabase(pool);
  await seedTwoWorkspaces(pool);
});

describe("postgres two-workspace isolation contract", () => {
  it("keeps inbound messages strictly per workspace", async () => {
    const sessions = new PostgresSessionRepository({ db: pool });
    const oneInbound: InboundMessageV1 = {
      ...exampleInboundMessage,
      id: "inbound-one",
      externalEventId: "$one",
      conversationId: "!same-room-shape:example",
      workspaceId: "workspace-one",
      threadRootExternalEventId: "$thread-one",
      text: "remember workspace one"
    };
    const twoInbound: InboundMessageV1 = {
      ...exampleInboundMessage,
      id: "inbound-two",
      externalEventId: "$two",
      conversationId: "!same-room-shape:example",
      workspaceId: "workspace-two",
      threadRootExternalEventId: "$thread-two",
      text: "remember workspace two"
    };

    await expect(
      sessions.listRecent({
        workspaceId: "workspace-one",
        now: new Date(),
        limit: 10,
        includeClosed: false
      })
    ).resolves.toEqual([]);
    await sessions.createAndBind({
      session: sessionRecord("session-one", "workspace-one"),
      workspaceId: "workspace-one",
      conversationId: "!same-room-shape:example"
    });
    await sessions.createAndBind({
      session: sessionRecord("session-two", "workspace-two"),
      workspaceId: "workspace-two",
      conversationId: "!same-room-shape:example"
    });

    await pool.query(
      `INSERT INTO brain_core.inbound_messages (
         id, schema_version, trace_id, transport, external_event_id, conversation_id, sender_id,
         received_at, kind, text_content, metadata, workspace_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9, $10, '{}'::jsonb, $11)`,
      [
        oneInbound.id,
        oneInbound.schemaVersion,
        oneInbound.traceId,
        oneInbound.transport,
        oneInbound.externalEventId,
        oneInbound.conversationId,
        oneInbound.senderId,
        oneInbound.receivedAt,
        oneInbound.kind,
        oneInbound.text ?? null,
        oneInbound.workspaceId
      ]
    );
    await pool.query(
      `INSERT INTO brain_core.inbound_messages (
         id, schema_version, trace_id, transport, external_event_id, conversation_id, sender_id,
         received_at, kind, text_content, metadata, workspace_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9, $10, '{}'::jsonb, $11)`,
      [
        twoInbound.id,
        twoInbound.schemaVersion,
        twoInbound.traceId,
        twoInbound.transport,
        twoInbound.externalEventId,
        twoInbound.conversationId,
        twoInbound.senderId,
        twoInbound.receivedAt,
        twoInbound.kind,
        twoInbound.text ?? null,
        twoInbound.workspaceId
      ]
    );

    const oneIds = await inboundIdsFor(pool, "workspace-one");
    const twoIds = await inboundIdsFor(pool, "workspace-two");
    expect(oneIds).toEqual(["inbound-one"]);
    expect(twoIds).toEqual(["inbound-two"]);
  });

  it("allows the same idempotency key in two workspaces without cross-write", async () => {
    const queue = new PostgresJobQueue({ db: pool });
    await queue.enqueue(sampleJob("job-one", "workspace-one", "shared"));
    await queue.enqueue(sampleJob("job-two", "workspace-two", "shared"));

    const oneIds = await jobIdsFor(pool, "workspace-one");
    const twoIds = await jobIdsFor(pool, "workspace-two");
    expect(oneIds).toEqual(["job-one"]);
    expect(twoIds).toEqual(["job-two"]);
  });

  it("keeps outbound idempotency workspace-scoped even with identical keys", async () => {
    const outbounds = new PostgresOutboundRepository({ db: pool });
    await outbounds.create(
      exampleOutboundMessageWithWorkspace("out-one", "workspace-one", "shared")
    );
    await outbounds.create(
      exampleOutboundMessageWithWorkspace("out-two", "workspace-two", "shared")
    );

    await expect(outbounds.getByIdempotencyKey("shared", "workspace-one")).resolves.toMatchObject({
      id: "out-one"
    });
    await expect(outbounds.getByIdempotencyKey("shared", "workspace-two")).resolves.toMatchObject({
      id: "out-two"
    });
  });

  it("keeps session bindings partitioned by workspace", async () => {
    const sessions = new PostgresSessionRepository({ db: pool });
    await sessions.createAndBind({
      session: sessionRecord("session-one-default", "workspace-one"),
      workspaceId: "workspace-one",
      conversationId: "!same-room-shape:example"
    });
    await sessions.createAndBind({
      session: sessionRecord("session-two-default", "workspace-two"),
      workspaceId: "workspace-two",
      conversationId: "!same-room-shape:example"
    });

    await expect(
      sessions.getActiveBinding({
        workspaceId: "workspace-one",
        conversationId: "!same-room-shape:example"
      })
    ).resolves.toMatchObject({ id: "session-one-default" });
    await expect(
      sessions.getActiveBinding({
        workspaceId: "workspace-two",
        conversationId: "!same-room-shape:example"
      })
    ).resolves.toMatchObject({ id: "session-two-default" });
  });

  it("keeps schedules scoped to their workspace", async () => {
    const schedules = new PostgresScheduleRepository({ db: pool });
    const one: ScheduledJobV1 = {
      ...exampleScheduledJob,
      id: "schedule-one",
      name: "Workspace one reminder",
      workspaceId: "workspace-one"
    };
    const two: ScheduledJobV1 = {
      ...exampleScheduledJob,
      id: "schedule-two",
      name: "Workspace two reminder",
      workspaceId: "workspace-two"
    };

    await schedules.create(one);
    await schedules.create(two);

    expect((await schedules.get("schedule-one"))?.workspaceId).toBe("workspace-one");
    expect((await schedules.get("schedule-two"))?.workspaceId).toBe("workspace-two");
    expect((await schedules.list()).map((schedule) => schedule.id).sort()).toEqual([
      "schedule-one",
      "schedule-two"
    ]);
  });
});

async function seedTwoWorkspaces(pool: Pool): Promise<void> {
  await pool.query(
    `
      INSERT INTO brain_core.workspaces (
        id, template_id, template_version, configuration, status, origin, created_at, updated_at
      )
      VALUES
        ('workspace-one', 'second-brain', '1.0.0', '{}', 'active', 'matrix_invite', now(), now()),
        ('workspace-two', 'second-brain', '1.0.0', '{}', 'active', 'matrix_invite', now(), now())
      ON CONFLICT (id) DO NOTHING
    `
  );
}

async function inboundIdsFor(pool: Pool, workspaceId: string): Promise<string[]> {
  const result = await pool.query<{ id: string }>(
    "SELECT id FROM brain_core.inbound_messages WHERE workspace_id = $1 ORDER BY id",
    [workspaceId]
  );
  return result.rows.map((row) => row.id);
}

async function jobIdsFor(pool: Pool, workspaceId: string): Promise<string[]> {
  const result = await pool.query<{ id: string }>(
    "SELECT id FROM brain_jobs.jobs WHERE workspace_id = $1 ORDER BY id",
    [workspaceId]
  );
  return result.rows.map((row) => row.id);
}

function sampleJob(id: string, workspaceId: string, idempotencyKey: string) {
  return {
    schemaVersion: 1 as const,
    id,
    workspaceId,
    type: "process_inbound" as const,
    payload: {},
    priority: 100,
    status: "pending" as const,
    attempts: 0,
    availableAt: new Date().toISOString(),
    idempotencyKey
  };
}

function exampleOutboundMessageWithWorkspace(
  id: string,
  workspaceId: string,
  idempotencyKey: string
): OutboundMessageV1 {
  return {
    ...exampleOutboundMessage,
    id,
    workspaceId,
    idempotencyKey
  };
}

function sessionRecord(id: string, workspaceId: string) {
  const now = new Date();
  return {
    id,
    workspaceId,
    label: undefined,
    status: "active" as const,
    createdAt: now,
    lastActiveAt: now,
    idleExpiresAt: new Date(now.getTime() + 60_000),
    absoluteExpiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    piSessionKey: id,
    sourceType: "default-room" as const,
    sourceConversationId: "!same-room-shape:example"
  };
}
