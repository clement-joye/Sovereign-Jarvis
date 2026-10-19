ALTER TABLE brain_core.agent_runs
    ADD COLUMN notice_origin jsonb;

UPDATE brain_core.schema_metadata
SET migration_number = 3
WHERE singleton = true
  AND migration_number = 2;
