ALTER TABLE brain_core.inbound_messages
ADD COLUMN audio_transcript text;

UPDATE brain_core.schema_metadata
SET migration_number = 5
WHERE singleton = true
  AND migration_number = 4;
