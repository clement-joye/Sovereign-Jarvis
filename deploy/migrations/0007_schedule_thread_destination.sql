ALTER TABLE brain_core.scheduled_jobs
  ADD COLUMN destination_thread_root_external_event_id text;

UPDATE brain_core.schema_metadata
SET migration_number = 7
WHERE singleton = true
  AND migration_number = 6;
