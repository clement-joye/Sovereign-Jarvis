import type { Pool, QueryResultRow } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  initialMigrations,
  PostgresAgentCollaborationRepository
} from "@second-brain/postgres-adapter";

import { startPostgresIntegrationHarness, type PostgresIntegrationHarness } from "./harness.js";

const latestMigration = Number(initialMigrations.at(-1)?.id);

describe("PostgreSQL public baseline", () => {
  let harness: PostgresIntegrationHarness;
  let pool: Pool;
  let baselineWorkspaceCount: number;

  beforeAll(async () => {
    harness = await startPostgresIntegrationHarness();
    pool = harness.pool;
    const workspaces = await pool.query<{ count: string }>(
      "SELECT count(*) FROM brain_core.workspaces"
    );
    baselineWorkspaceCount = Number(workspaces.rows[0]?.count);
    await pool.query(`
      INSERT INTO brain_core.workspaces (
        id, template_id, template_version, configuration, status, origin, created_at, updated_at
      ) VALUES (
        'workspace-default', 'second-brain', '1.0.0', '{}', 'active', 'setup', now(), now()
      )
    `);
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it("creates the expected application schemas and tables", async () => {
    await expect(listSchemas()).resolves.toEqual(["brain_audit", "brain_core", "brain_jobs"]);
    await expect(listTables()).resolves.toEqual([
      "brain_audit.audit_events",
      "brain_core.action_approval_policies",
      "brain_core.action_proposals",
      "brain_core.agent_artifacts",
      "brain_core.agent_runs",
      "brain_core.attachments",
      "brain_core.conversation_preferences",
      "brain_core.delegation_grants",
      "brain_core.delegation_notice_claims",
      "brain_core.delivery_attempts",
      "brain_core.idempotency_records",
      "brain_core.inbound_message_attachments",
      "brain_core.inbound_messages",
      "brain_core.outbound_message_files",
      "brain_core.outbound_message_images",
      "brain_core.outbound_messages",
      "brain_core.retention_tombstones",
      "brain_core.root_run_admissions",
      "brain_core.scheduled_executions",
      "brain_core.scheduled_jobs",
      "brain_core.schema_metadata",
      "brain_core.session_bindings",
      "brain_core.sessions",
      "brain_core.thread_agent_selections",
      "brain_core.workspace_plugin_bindings",
      "brain_core.workspace_room_bindings",
      "brain_core.workspace_write_leases",
      "brain_core.workspaces",
      "brain_jobs.jobs"
    ]);
  });

  it("does not hide a default workspace seed in the public baseline", () => {
    expect(baselineWorkspaceCount).toBe(0);
  });

  it("creates indexes and unique constraints required for idempotency and claiming", async () => {
    await expect(indexExists("brain_jobs", "jobs_claim_idx")).resolves.toBe(true);
    await expect(indexExists("brain_core", "agent_runs_root_status_idx")).resolves.toBe(true);
    await expect(indexExists("brain_core", "root_run_admissions_state_expiry_idx")).resolves.toBe(
      true
    );
    await expect(
      indexExists("brain_core", "root_run_admissions_workspace_state_idx")
    ).resolves.toBe(true);
    await expect(uniqueConstraintColumns("brain_core", "inbound_messages")).resolves.toContain(
      "external_event_id,transport"
    );
    await expect(uniqueConstraintColumns("brain_core", "attachments")).resolves.toContain(
      "storage_key"
    );
    await expect(uniqueConstraintColumns("brain_core", "scheduled_executions")).resolves.toContain(
      "schedule_id,scheduled_for"
    );
    await expect(uniqueConstraintColumns("brain_jobs", "jobs")).resolves.toContain(
      "idempotency_key,workspace_id"
    );
    await expect(uniqueConstraintColumns("brain_core", "outbound_messages")).resolves.toContain(
      "idempotency_key,workspace_id"
    );
    await expect(uniqueConstraintColumns("brain_core", "session_bindings")).resolves.toContain(
      "agent_id,conversation_id,schedule_id,thread_root_external_event_id,workspace_id"
    );
    await expect(uniqueConstraintColumns("brain_core", "root_run_admissions")).resolves.toContain(
      "root_job_id"
    );
  });

  it("enforces root-run lineage and admission lease invariants", async () => {
    const digest = `sha256:${"a".repeat(64)}`;
    await pool.query(
      `INSERT INTO brain_jobs.jobs (
         id, schema_version, type, payload, priority, status, available_at,
         idempotency_key, workspace_id
       ) VALUES (
         'admission-job-a', 1, 'process_inbound', '{}'::jsonb, 1, 'queued', now(),
         'admission-job-a', 'workspace-default'
       )`
    );
    await pool.query(
      `INSERT INTO brain_core.agent_runs (
         id, workspace_id, agent_id, catalog_version, catalog_digest, status,
         root_run_id, deadline_at, timeout_seconds, token_budget, created_at
       ) VALUES
         ('admission-root-a', 'workspace-default', 'brain', '1', $1, 'queued',
          'admission-root-a', now() + interval '1 hour', 60, 1000, now()),
         ('admission-root-b', 'workspace-default', 'brain', '1', $1, 'queued',
          'admission-root-b', now() + interval '1 hour', 60, 1000, now())`,
      [digest]
    );

    await expect(
      pool.query(
        `INSERT INTO brain_core.agent_runs (
           id, workspace_id, agent_id, catalog_version, catalog_digest, status,
           parent_run_id, root_run_id, deadline_at, timeout_seconds, token_budget, created_at
         ) VALUES (
           'invalid-cross-root-child', 'workspace-default', 'brain', '1', $1, 'queued',
           'admission-root-a', 'admission-root-b', now() + interval '1 hour', 60, 1000, now()
         )`,
        [digest]
      )
    ).rejects.toThrow();

    await pool.query(
      `INSERT INTO brain_core.root_run_admissions (
         root_run_id, root_job_id, workspace_id, lease_owner,
         acquired_at, heartbeat_at, expires_at, state
       ) VALUES (
         'admission-root-a', 'admission-job-a', 'workspace-default', 'worker-a',
         now(), now(), now() + interval '1 minute', 'active'
       )`
    );
    await expect(
      pool.query(
        `UPDATE brain_core.root_run_admissions
         SET state = 'released'
         WHERE root_run_id = 'admission-root-a'`
      )
    ).rejects.toThrow();
    await expect(
      pool.query(
        `UPDATE brain_core.root_run_admissions
         SET expires_at = heartbeat_at
         WHERE root_run_id = 'admission-root-a'`
      )
    ).rejects.toThrow();

    await expect(
      pool.query<{ is_nullable: string }>(
        `SELECT is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'brain_core'
           AND table_name = 'agent_runs'
           AND column_name = 'root_run_id'`
      )
    ).resolves.toMatchObject({ rows: [{ is_nullable: "NO" }] });
  });

  it("preserves nullable durable execution identities for historical runs", async () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const policyDigest = `sha256:${"b".repeat(64)}`;
    const resourceDigest = `sha256:${"c".repeat(64)}`;
    const runtimeImageId = `jarvis/runtime@sha256:${"d".repeat(64)}`;

    await pool.query(
      `INSERT INTO brain_core.agent_runs (
         id, workspace_id, agent_id, catalog_version, catalog_digest,
         effective_policy_digest, platform_policy_digest, resource_digest, runtime_image_id,
         status, root_run_id, deadline_at, timeout_seconds, token_budget, created_at
       ) VALUES (
         'identified-run', 'workspace-default', 'brain', '1', $1, $2, $2, $3, $4,
         'queued', 'identified-run', now() + interval '1 hour', 60, 1000, now()
       )`,
      [digest, policyDigest, resourceDigest, runtimeImageId]
    );
    await pool.query(
      `INSERT INTO brain_core.agent_runs (
         id, workspace_id, agent_id, catalog_version, catalog_digest,
         status, root_run_id, deadline_at, timeout_seconds, token_budget, created_at
       ) VALUES (
         'legacy-identity-run', 'workspace-default', 'brain', '1', $1,
         'queued', 'legacy-identity-run', now() + interval '1 hour', 60, 1000, now()
       )`,
      [digest]
    );

    await expect(
      pool.query(
        `SELECT id, effective_policy_digest, platform_policy_digest, resource_digest, runtime_image_id
         FROM brain_core.agent_runs
         WHERE id IN ('identified-run', 'legacy-identity-run')
         ORDER BY id`
      )
    ).resolves.toMatchObject({
      rows: [
        {
          id: "identified-run",
          effective_policy_digest: policyDigest,
          platform_policy_digest: policyDigest,
          resource_digest: resourceDigest,
          runtime_image_id: runtimeImageId
        },
        {
          id: "legacy-identity-run",
          effective_policy_digest: null,
          platform_policy_digest: null,
          resource_digest: null,
          runtime_image_id: null
        }
      ]
    });
    await expect(
      pool.query(
        `UPDATE brain_core.agent_runs
         SET effective_policy_digest = 'not-a-digest'
         WHERE id = 'identified-run'`
      )
    ).rejects.toThrow();
  });

  it("defaults persisted schedules to the Brain executor", async () => {
    const result = await pool.query<{ column_default: string | null; is_nullable: string }>(
      `
        SELECT column_default, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'brain_core'
          AND table_name = 'scheduled_jobs'
          AND column_name = 'agent_id'
      `
    );
    expect(result.rows).toEqual([{ column_default: "'brain'::text", is_nullable: "NO" }]);
  });

  it("records the applied schema migration compatibility marker", async () => {
    await expect(
      pool.query<{ migration_number: number }>(
        "SELECT migration_number FROM brain_core.schema_metadata WHERE singleton = true"
      )
    ).resolves.toMatchObject({ rows: [{ migration_number: latestMigration }] });
  });

  it("persists the agent-run notice origin column", async () => {
    await expect(
      pool.query<{ column_name: string; data_type: string; is_nullable: string }>(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'brain_core'
          AND table_name = 'agent_runs'
          AND column_name = 'notice_origin'
      `)
    ).resolves.toMatchObject({
      rows: [{ column_name: "notice_origin", data_type: "jsonb", is_nullable: "YES" }]
    });
  });

  it("caps immediate delegation notices durably across retries", async () => {
    const digest = `sha256:${"a".repeat(64)}`;
    await pool.query(
      `INSERT INTO brain_core.agent_runs (
         id, workspace_id, agent_id, catalog_version, catalog_digest, status,
         parent_run_id, root_run_id, deadline_at, timeout_seconds, created_at
       ) VALUES
         ('notice-cap-root', 'workspace-default', 'brain', '1', $1, 'running',
          NULL, 'notice-cap-root', now() + interval '1 hour', 60, now()),
         ('notice-cap-child-1', 'workspace-default', 'brain', '1', $1, 'queued',
          'notice-cap-root', 'notice-cap-root', now() + interval '1 hour', 60, now()),
         ('notice-cap-child-2', 'workspace-default', 'brain', '1', $1, 'queued',
          'notice-cap-root', 'notice-cap-root', now() + interval '1 hour', 60, now()),
         ('notice-cap-child-3', 'workspace-default', 'brain', '1', $1, 'queued',
          'notice-cap-root', 'notice-cap-root', now() + interval '1 hour', 60, now())`,
      [digest]
    );
    const claims = new PostgresAgentCollaborationRepository(pool);

    await expect(
      claims.claimDelegationNotice("notice-cap-root", "notice-cap-child-1", 2)
    ).resolves.toBe(true);
    await expect(
      claims.claimDelegationNotice("notice-cap-root", "notice-cap-child-1", 2)
    ).resolves.toBe(true);
    await expect(
      claims.claimDelegationNotice("notice-cap-root", "notice-cap-child-2", 2)
    ).resolves.toBe(true);
    await expect(
      claims.claimDelegationNotice("notice-cap-root", "notice-cap-child-3", 2)
    ).resolves.toBe(false);
    await expect(
      claims.claimDelegationNotice("notice-cap-root", "notice-cap-child-3", 2)
    ).resolves.toBe(false);
  });

  it("creates foreign keys that enforce ownership and retention boundaries", async () => {
    await expect(foreignKeys()).resolves.toEqual(
      expect.arrayContaining([
        {
          table_name: "inbound_message_attachments",
          column_name: "inbound_message_id",
          foreign_table_name: "inbound_messages",
          delete_rule: "CASCADE"
        },
        {
          table_name: "inbound_message_attachments",
          column_name: "attachment_id",
          foreign_table_name: "attachments",
          delete_rule: "RESTRICT"
        },
        {
          table_name: "scheduled_executions",
          column_name: "schedule_id",
          foreign_table_name: "scheduled_jobs",
          delete_rule: "RESTRICT"
        },
        {
          table_name: "outbound_messages",
          column_name: "audio_attachment_id",
          foreign_table_name: "attachments",
          delete_rule: "RESTRICT"
        },
        {
          table_name: "outbound_message_images",
          column_name: "outbound_message_id",
          foreign_table_name: "outbound_messages",
          delete_rule: "CASCADE"
        },
        {
          table_name: "inbound_messages",
          column_name: "workspace_id",
          foreign_table_name: "workspaces",
          delete_rule: "RESTRICT"
        },
        {
          table_name: "workspace_room_bindings",
          column_name: "workspace_id",
          foreign_table_name: "workspaces",
          delete_rule: "RESTRICT"
        },
        {
          table_name: "action_approval_policies",
          column_name: "workspace_id",
          foreign_table_name: "workspaces",
          delete_rule: "RESTRICT"
        },
        {
          table_name: "agent_runs",
          column_name: "root_run_id",
          foreign_table_name: "agent_runs",
          delete_rule: "RESTRICT"
        },
        {
          table_name: "root_run_admissions",
          column_name: "root_job_id",
          foreign_table_name: "jobs",
          delete_rule: "RESTRICT"
        },
        {
          table_name: "root_run_admissions",
          column_name: "workspace_id",
          foreign_table_name: "workspaces",
          delete_rule: "RESTRICT"
        }
      ])
    );
  });

  it("enforces stable discriminator values for new persisted rows", async () => {
    await expect(
      pool.query(
        `
          INSERT INTO brain_core.attachments (
            id, schema_version, purpose, media_type, size_bytes, sha256, storage_key
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          "invalid-purpose-attachment",
          1,
          "unexpected",
          "image/jpeg",
          1,
          "a".repeat(64),
          "invalid-purpose-attachment"
        ]
      )
    ).rejects.toThrow();
  });

  it("allows catalog-defined agent identifiers and rejects malformed values", async () => {
    const result = await pool.query<{ definition: string }>(
      `
        SELECT pg_get_constraintdef(constraint_record.oid) AS definition
        FROM pg_constraint AS constraint_record
        WHERE constraint_record.conname IN (
          'workspaces_default_agent_check',
          'inbound_messages_agent_id_check',
          'session_bindings_agent_id_check',
          'thread_agent_selections_agent_id_check',
          'workspace_plugin_bindings_agents_check'
        )
      `
    );
    expect(result.rows).toHaveLength(5);
    expect(result.rows.map((row) => row.definition).join(" ")).toContain("a-z0-9-");

    await expect(
      pool.query("UPDATE brain_core.workspaces SET default_agent = $1 WHERE id = $2", [
        "fixture-agent",
        "workspace-default"
      ])
    ).resolves.toBeDefined();
    await expect(
      pool.query(
        `INSERT INTO brain_core.workspace_plugin_bindings
          (workspace_id, plugin_id, plugin_version, enabled_agents)
         VALUES ($1, $2, $3, $4)`,
        ["workspace-default", "fixture-plugin", "1", ["fixture-agent"]]
      )
    ).resolves.toBeDefined();
    await expect(
      pool.query("UPDATE brain_core.workspaces SET default_agent = $1 WHERE id = $2", [
        "Bad_Agent",
        "workspace-default"
      ])
    ).rejects.toThrow();
    await expect(
      pool.query(
        "UPDATE brain_core.workspace_plugin_bindings SET enabled_agents = $1 WHERE workspace_id = $2 AND plugin_id = $3",
        [[], "workspace-default", "fixture-plugin"]
      )
    ).rejects.toThrow();
    await expect(
      pool.query(
        "UPDATE brain_core.workspace_plugin_bindings SET enabled_agents = $1 WHERE workspace_id = $2 AND plugin_id = $3",
        [["fixture-agent,Bad_Agent"], "workspace-default", "fixture-plugin"]
      )
    ).rejects.toThrow();
    await pool.query(
      "DELETE FROM brain_core.workspace_plugin_bindings WHERE workspace_id = $1 AND plugin_id = $2",
      ["workspace-default", "fixture-plugin"]
    );
    await pool.query("UPDATE brain_core.workspaces SET default_agent = $1 WHERE id = $2", [
      "brain",
      "workspace-default"
    ]);
  });

  it("creates the same complete schema from a second empty database", async () => {
    const secondHarness = await startPostgresIntegrationHarness();
    try {
      await expect(
        secondHarness.pool.query<{ migration_number: number }>(
          "SELECT migration_number FROM brain_core.schema_metadata WHERE singleton = true"
        )
      ).resolves.toMatchObject({ rows: [{ migration_number: latestMigration }] });
      const tables = await secondHarness.pool.query<{ count: string }>(`
          SELECT count(*)
          FROM information_schema.tables
          WHERE table_schema IN ('brain_core', 'brain_jobs', 'brain_audit')
            AND table_type = 'BASE TABLE'
        `);
      expect(Number(tables.rows[0]?.count)).toBe(29);
    } finally {
      await secondHarness.stop();
    }
  }, 120_000);

  async function listSchemas(): Promise<string[]> {
    const result = await pool.query<{ schema_name: string }>(
      `
        SELECT schema_name
        FROM information_schema.schemata
        WHERE schema_name IN ('brain_core', 'brain_jobs', 'brain_audit')
        ORDER BY schema_name ASC
      `
    );
    return result.rows.map((row) => row.schema_name);
  }

  async function listTables(): Promise<string[]> {
    const result = await pool.query<{ table_name: string }>(
      `
        SELECT table_schema || '.' || table_name AS table_name
        FROM information_schema.tables
        WHERE table_schema IN ('brain_core', 'brain_jobs', 'brain_audit')
          AND table_type = 'BASE TABLE'
        ORDER BY table_schema ASC, table_name ASC
      `
    );
    return result.rows.map((row) => row.table_name);
  }

  async function indexExists(schemaName: string, indexName: string): Promise<boolean> {
    const result = await pool.query(
      `
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = $1
          AND indexname = $2
      `,
      [schemaName, indexName]
    );
    return result.rowCount === 1;
  }

  async function uniqueConstraintColumns(schemaName: string, tableName: string): Promise<string[]> {
    const result = await pool.query<{ columns: string }>(
      `
        SELECT string_agg(attribute.attname, ',' ORDER BY attribute.attname) AS columns
        FROM pg_constraint AS constraint_record
        INNER JOIN pg_class AS table_record
          ON table_record.oid = constraint_record.conrelid
        INNER JOIN pg_namespace AS namespace_record
          ON namespace_record.oid = table_record.relnamespace
        INNER JOIN unnest(constraint_record.conkey) AS constrained_attribute(attribute_number)
          ON true
        INNER JOIN pg_attribute AS attribute
          ON attribute.attrelid = table_record.oid
         AND attribute.attnum = constrained_attribute.attribute_number
        WHERE namespace_record.nspname = $1
          AND table_record.relname = $2
          AND constraint_record.contype = 'u'
        GROUP BY constraint_record.oid
        ORDER BY columns ASC
      `,
      [schemaName, tableName]
    );
    return result.rows.map((row) => row.columns);
  }

  async function foreignKeys(): Promise<ForeignKeyRow[]> {
    const result = await pool.query<ForeignKeyRow>(
      `
        SELECT
          table_record.relname AS table_name,
          attribute.attname AS column_name,
          foreign_table.relname AS foreign_table_name,
          CASE constraint_record.confdeltype
            WHEN 'a' THEN 'NO ACTION'
            WHEN 'r' THEN 'RESTRICT'
            WHEN 'c' THEN 'CASCADE'
            WHEN 'n' THEN 'SET NULL'
            WHEN 'd' THEN 'SET DEFAULT'
          END AS delete_rule
        FROM pg_constraint AS constraint_record
        INNER JOIN pg_class AS table_record
          ON table_record.oid = constraint_record.conrelid
        INNER JOIN pg_namespace AS namespace_record
          ON namespace_record.oid = table_record.relnamespace
        INNER JOIN pg_class AS foreign_table
          ON foreign_table.oid = constraint_record.confrelid
        INNER JOIN unnest(constraint_record.conkey) AS constrained_attribute(attribute_number)
          ON true
        INNER JOIN pg_attribute AS attribute
          ON attribute.attrelid = table_record.oid
         AND attribute.attnum = constrained_attribute.attribute_number
        WHERE namespace_record.nspname = 'brain_core'
          AND constraint_record.contype = 'f'
        ORDER BY table_name ASC, column_name ASC
      `
    );
    return result.rows;
  }
});

interface ForeignKeyRow extends QueryResultRow {
  table_name: string;
  column_name: string;
  foreign_table_name: string;
  delete_rule: string;
}
