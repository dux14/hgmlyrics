-- 0008_song_key.sql
-- Adds optional `key` column to `songs` with 24 valid musical keys (12 chromatic × major/minor).
-- NULL = no key assigned (initial state for the 114 existing rows).

ALTER TABLE songs ADD COLUMN IF NOT EXISTS key TEXT;

ALTER TABLE songs DROP CONSTRAINT IF EXISTS songs_key_valid;

ALTER TABLE songs ADD CONSTRAINT songs_key_valid CHECK (
  key IS NULL OR key IN (
    'C major',  'C# major', 'D major',  'D# major', 'E major',  'F major',
    'F# major', 'G major',  'G# major', 'A major',  'A# major', 'B major',
    'C minor',  'C# minor', 'D minor',  'D# minor', 'E minor',  'F minor',
    'F# minor', 'G minor',  'G# minor', 'A minor',  'A# minor', 'B minor'
  )
);

GRANT UPDATE (key) ON songs TO authenticated;
