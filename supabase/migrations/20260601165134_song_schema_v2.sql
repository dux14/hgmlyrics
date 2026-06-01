-- song_schema_v2.sql
-- Aditivo: roster de voces + versión de esquema. NO reescribe `sections`.

ALTER TABLE songs ADD COLUMN IF NOT EXISTS voice_roster   JSONB   NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 1;
