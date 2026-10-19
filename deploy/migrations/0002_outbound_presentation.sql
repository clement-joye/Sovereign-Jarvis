ALTER TABLE brain_core.outbound_messages
    ADD COLUMN presentation text NOT NULL DEFAULT 'assistant';

ALTER TABLE brain_core.outbound_messages
    ADD CONSTRAINT outbound_messages_presentation_check
    CHECK (presentation IN ('assistant', 'notice', 'error'));

UPDATE brain_core.schema_metadata
SET migration_number = 2
WHERE singleton = true
  AND migration_number = 1;
