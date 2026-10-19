import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initialMigrations } from "@second-brain/postgres-adapter";

import { startPostgresIntegrationHarness, type PostgresIntegrationHarness } from "./harness.js";

describe("retired agent reference migration", () => {
  let harness: PostgresIntegrationHarness;

  beforeAll(async () => {
    harness = await startPostgresIntegrationHarness({
      migrations: initialMigrations.filter(({ id }) => id < "0006")
    });
    const { pool } = harness;
    const digest = `sha256:${"a".repeat(64)}`;

    await pool.query(`
      INSERT INTO brain_core.workspaces (
        id, template_id, template_version, configuration, status, origin,
        created_at, updated_at, default_agent
      ) VALUES (
        'identity-workspace', 'second-brain', '1.0.0', '{}', 'active', 'migration',
        now(), now(), 'planner'
      )
    `);
    await pool.query(`
      INSERT INTO brain_core.sessions (
        id, status, created_at, last_active_at, idle_expires_at, absolute_expires_at,
        pi_session_key, source_type, version, workspace_id
      ) VALUES (
        'identity-session', 'active', now(), now(), now() + interval '1 hour',
        now() + interval '1 day', 'identity-session-key', 'default-room', 1,
        'identity-workspace'
      )
    `);
    await pool.query(`
      INSERT INTO brain_core.session_bindings (
        id, active_session_id, workspace_id, agent_id
      ) VALUES ('identity-binding', 'identity-session', 'identity-workspace', 'coordinator')
    `);
    await pool.query(`
      INSERT INTO brain_core.thread_agent_selections (
        workspace_id, conversation_id, thread_root_external_event_id, agent_id
      ) VALUES ('identity-workspace', 'conversation', 'event', 'planner')
    `);
    await pool.query(`
      INSERT INTO brain_core.scheduled_jobs (
        id, schema_version, name, instruction, schedule, enabled, session_policy,
        notification_policy, overlap_policy, missed_run_policy, timeout_seconds,
        version, created_at, updated_at, workspace_id, agent_id
      ) VALUES
        ('identity-enabled-schedule', 1, 'Enabled', 'Run', '{}', true, '{}',
         'none', 'skip', 'skip', 60, 1, now(), now(), 'identity-workspace', 'coordinator'),
        ('identity-disabled-schedule', 1, 'Disabled', 'Run', '{}', false, '{}',
         'none', 'skip', 'skip', 60, 1, now(), now(), 'identity-workspace', 'planner')
    `);
    await pool.query(
      `INSERT INTO brain_core.agent_runs (
         id, workspace_id, agent_id, catalog_version, catalog_digest, status,
         root_run_id, deadline_at, timeout_seconds, created_at
       ) VALUES
         ('identity-active-run', 'identity-workspace', 'planner', '1', $1,
          'queued', 'identity-active-run', now() + interval '1 hour', 60, now()),
         ('identity-completed-run', 'identity-workspace', 'coordinator', '1', $1,
          'completed', 'identity-completed-run', now(), 60, now())`,
      [digest]
    );
    await pool.query(`
      INSERT INTO brain_core.delegation_grants (
        id, parent_run_id, workspace_id, child_agent_id, allowed_tools,
        writable_paths, timeout_seconds, expires_at
      ) VALUES
        ('identity-active-grant', 'identity-active-run', 'identity-workspace',
         'coordinator', '{}', '{}', 60, now() + interval '1 hour'),
        ('identity-completed-grant', 'identity-completed-run', 'identity-workspace',
         'planner', '{}', '{}', 60, now() + interval '1 hour')
    `);
    await pool.query(
      `INSERT INTO brain_core.action_proposals (
         id, schema_version, operation_digest, workspace_id, agent_id, run_id,
         plugin_id, capability_id, operation_id, operation_version, summary,
         parameters, approval_mode, required_approver, idempotency_key, status,
         created_at, expires_at
       ) VALUES (
         'identity-proposal', 1, $1, 'identity-workspace', 'coordinator',
         'identity-active-run', 'plugin', 'capability', 'operation', '1', 'summary',
         '{}', 'none', 'none', 'identity-proposal', 'proposed', now(), now() + interval '1 hour'
       )`,
      [digest]
    );
    await pool.query(`
      INSERT INTO brain_core.workspace_plugin_bindings (
        workspace_id, plugin_id, plugin_version, enabled_agents
      ) VALUES (
        'identity-workspace', 'plugin', '1', ARRAY['planner', 'coordinator', 'orchestrator', 'brain']
      )
    `);
    await pool.query(`
      INSERT INTO brain_jobs.jobs (
        id, schema_version, type, payload, priority, status, available_at,
        idempotency_key, workspace_id
      ) VALUES
        ('identity-pending-job', 1, 'process_inbound',
         '{"agentId":"planner","keep":{"agentId":"coordinator"}}', 1, 'pending',
         now(), 'identity-pending-job', 'identity-workspace'),
        ('identity-completed-job', 1, 'process_inbound',
         '{"agentId":"coordinator"}', 1, 'completed', now(),
         'identity-completed-job', 'identity-workspace')
    `);

    const migration = await readFile(
      new URL(
        "../../../deploy/migrations/0006_migrate_retired_agent_references.sql",
        import.meta.url
      ),
      "utf8"
    );
    await pool.query(migration);
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it("rewrites active durable references while retaining historical records", async () => {
    const { pool } = harness;
    const result = await pool.query<{
      default_agent: string;
      binding_agent: string;
      thread_agent: string;
      enabled_schedule_agent: string;
      disabled_schedule_agent: string;
      active_run_agent: string;
      completed_run_agent: string;
      active_grant_agent: string;
      completed_grant_agent: string;
      proposal_agent: string;
      enabled_agents: string[];
      pending_payload: { agentId: string; keep: { agentId: string } };
      completed_payload: { agentId: string };
      migration_number: number;
    }>(`
      SELECT
        workspaces.default_agent,
        session_bindings.agent_id AS binding_agent,
        thread_agent_selections.agent_id AS thread_agent,
        enabled_schedule.agent_id AS enabled_schedule_agent,
        disabled_schedule.agent_id AS disabled_schedule_agent,
        active_run.agent_id AS active_run_agent,
        completed_run.agent_id AS completed_run_agent,
        active_grant.child_agent_id AS active_grant_agent,
        completed_grant.child_agent_id AS completed_grant_agent,
        action_proposals.agent_id AS proposal_agent,
        workspace_plugin_bindings.enabled_agents,
        pending_job.payload AS pending_payload,
        completed_job.payload AS completed_payload,
        schema_metadata.migration_number
      FROM brain_core.workspaces
      JOIN brain_core.session_bindings ON session_bindings.id = 'identity-binding'
      JOIN brain_core.thread_agent_selections
        ON thread_agent_selections.conversation_id = 'conversation'
      JOIN brain_core.scheduled_jobs AS enabled_schedule
        ON enabled_schedule.id = 'identity-enabled-schedule'
      JOIN brain_core.scheduled_jobs AS disabled_schedule
        ON disabled_schedule.id = 'identity-disabled-schedule'
      JOIN brain_core.agent_runs AS active_run ON active_run.id = 'identity-active-run'
      JOIN brain_core.agent_runs AS completed_run ON completed_run.id = 'identity-completed-run'
      JOIN brain_core.delegation_grants AS active_grant ON active_grant.id = 'identity-active-grant'
      JOIN brain_core.delegation_grants AS completed_grant
        ON completed_grant.id = 'identity-completed-grant'
      JOIN brain_core.action_proposals ON action_proposals.id = 'identity-proposal'
      JOIN brain_core.workspace_plugin_bindings
        ON workspace_plugin_bindings.plugin_id = 'plugin'
      JOIN brain_jobs.jobs AS pending_job ON pending_job.id = 'identity-pending-job'
      JOIN brain_jobs.jobs AS completed_job ON completed_job.id = 'identity-completed-job'
      CROSS JOIN brain_core.schema_metadata
      WHERE workspaces.id = 'identity-workspace'
    `);

    expect(result.rows).toEqual([
      {
        default_agent: "orchestrator",
        binding_agent: "orchestrator",
        thread_agent: "orchestrator",
        enabled_schedule_agent: "orchestrator",
        disabled_schedule_agent: "planner",
        active_run_agent: "orchestrator",
        completed_run_agent: "coordinator",
        active_grant_agent: "orchestrator",
        completed_grant_agent: "planner",
        proposal_agent: "orchestrator",
        enabled_agents: ["orchestrator", "brain"],
        pending_payload: { agentId: "orchestrator", keep: { agentId: "coordinator" } },
        completed_payload: { agentId: "coordinator" },
        migration_number: 6
      }
    ]);
  });
});
