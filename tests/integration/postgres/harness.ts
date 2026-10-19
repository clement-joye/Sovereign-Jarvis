import { readFile } from "node:fs/promises";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import {
  createPostgresPool,
  initialMigrations,
  type MigrationDescriptor
} from "@second-brain/postgres-adapter";
import type { Pool } from "pg";

const postgresImage = process.env.JARVIS_POSTGRES_TEST_IMAGE ?? "postgres:16-alpine";

export interface PostgresIntegrationHarness {
  readonly pool: Pool;
  stop(): Promise<void>;
}

export async function startPostgresIntegrationHarness(
  options: {
    migrations?: readonly MigrationDescriptor[];
  } = {}
): Promise<PostgresIntegrationHarness> {
  const container = await new PostgreSqlContainer(postgresImage).start();
  const pool = createPostgresPool(container.getConnectionUri());

  try {
    await applyMigrations(pool, options.migrations);
  } catch (error) {
    await pool.end();
    await container.stop();
    throw error;
  }

  return {
    pool,
    stop: async () => {
      await pool.end();
      await container.stop();
    }
  };
}

export async function applyMigrations(
  pool: Pool,
  migrations: readonly MigrationDescriptor[] = initialMigrations
): Promise<void> {
  for (const migration of migrations) {
    await pool.query(
      await readFile(new URL(`../../../${migration.path}`, import.meta.url), "utf8")
    );
  }
}

export async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query(`
    TRUNCATE
      brain_core.action_approval_policies,
      brain_core.action_proposals,
      brain_core.delivery_attempts,
      brain_core.agent_artifacts,
      brain_core.delegation_notice_claims,
      brain_core.workspace_write_leases,
      brain_core.delegation_grants,
      brain_core.agent_runs,
      brain_core.workspace_plugin_bindings,
      brain_core.thread_agent_selections,
      brain_core.conversation_preferences,
      brain_core.idempotency_records,
      brain_core.inbound_message_attachments,
      brain_core.outbound_message_images,
      brain_core.outbound_messages,
      brain_core.scheduled_executions,
      brain_core.session_bindings,
      brain_core.sessions,
      brain_core.scheduled_jobs,
      brain_core.inbound_messages,
      brain_core.attachments,
      brain_core.retention_tombstones,
      brain_jobs.jobs,
      brain_audit.audit_events
    RESTART IDENTITY CASCADE
  `);
  await pool.query(`
    INSERT INTO brain_core.workspaces (
      id, template_id, template_version, configuration, status, origin, created_at, updated_at
    ) VALUES (
      'workspace-example', 'second-brain', '1.0.0', '{}', 'active', 'migration', now(), now()
    ) ON CONFLICT (id) DO NOTHING
  `);
}
