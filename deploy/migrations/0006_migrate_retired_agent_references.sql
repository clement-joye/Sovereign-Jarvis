-- Route actionable durable references from the retired planner and coordinator
-- identities through the replacement orchestrator agent. Historical execution
-- and message records remain unchanged.

UPDATE brain_core.workspaces
SET default_agent = 'orchestrator'
WHERE default_agent IN ('planner', 'coordinator');

UPDATE brain_core.session_bindings
SET agent_id = 'orchestrator'
WHERE agent_id IN ('planner', 'coordinator');

UPDATE brain_core.thread_agent_selections
SET agent_id = 'orchestrator'
WHERE agent_id IN ('planner', 'coordinator');

UPDATE brain_core.scheduled_jobs
SET agent_id = 'orchestrator'
WHERE agent_id IN ('planner', 'coordinator')
  AND enabled = true
  AND deleted_at IS NULL;

UPDATE brain_core.agent_runs
SET agent_id = 'orchestrator'
WHERE agent_id IN ('planner', 'coordinator')
  AND status IN ('queued', 'running');

UPDATE brain_core.delegation_grants AS grants
SET child_agent_id = 'orchestrator'
FROM brain_core.agent_runs AS parents
WHERE grants.parent_run_id = parents.id
  AND grants.child_agent_id IN ('planner', 'coordinator')
  AND parents.status IN ('queued', 'running')
  AND grants.expires_at > now();

UPDATE brain_core.action_proposals
SET agent_id = 'orchestrator'
WHERE agent_id IN ('planner', 'coordinator')
  AND status IN ('proposed', 'approved');

UPDATE brain_core.workspace_plugin_bindings
SET enabled_agents = ARRAY(
  SELECT mapped.agent_id
  FROM (
    SELECT CASE
        WHEN entries.agent_id IN ('planner', 'coordinator') THEN 'orchestrator'
        ELSE entries.agent_id
      END AS agent_id,
      min(entries.position) AS first_position
    FROM unnest(enabled_agents) WITH ORDINALITY AS entries(agent_id, position)
    GROUP BY 1
  ) AS mapped
  ORDER BY mapped.first_position
)
WHERE 'planner' = ANY (enabled_agents)
   OR 'coordinator' = ANY (enabled_agents);

UPDATE brain_jobs.jobs
SET payload = jsonb_set(payload, '{agentId}', '"orchestrator"'::jsonb, false)
WHERE status IN ('pending', 'leased', 'running', 'retry_wait')
  AND jsonb_typeof(payload) = 'object'
  AND payload->>'agentId' IN ('planner', 'coordinator');

UPDATE brain_core.schema_metadata
SET migration_number = 6
WHERE singleton = true
  AND migration_number = 5;
