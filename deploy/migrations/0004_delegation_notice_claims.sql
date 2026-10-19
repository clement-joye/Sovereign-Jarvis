CREATE TABLE brain_core.delegation_notice_claims (
    root_run_id text NOT NULL REFERENCES brain_core.agent_runs(id) ON DELETE CASCADE,
    child_run_id text NOT NULL REFERENCES brain_core.agent_runs(id) ON DELETE CASCADE,
    notice_allowed boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (root_run_id, child_run_id)
);

UPDATE brain_core.schema_metadata
SET migration_number = 4
WHERE singleton = true
  AND migration_number = 3;
