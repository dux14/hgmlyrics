-- Phase 2 initial schema for hgmlyrics.
-- Mirrors the Turso `songs` table but uses snake_case column names,
-- JSONB for `sections`, TIMESTAMPTZ for timestamps, and adds RLS.
--
-- Triggers: `set_updated_at()` fires BEFORE UPDATE only, so initial
-- data load (INSERT with explicit updated_at) preserves Turso timestamps.

CREATE TABLE songs (
  id                    TEXT PRIMARY KEY,
  title                 TEXT NOT NULL,
  artist                TEXT,
  album                 TEXT,
  album_slug            TEXT,
  year                  INTEGER,
  genre                 TEXT,
  voice_type            TEXT,
  voice_percent_male    INTEGER,
  voice_percent_female  INTEGER,
  cover_image           TEXT,
  sections              JSONB NOT NULL DEFAULT '[]'::jsonb,
  album_order           INTEGER NOT NULL DEFAULT 0,
  cejilla               INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX songs_album_order_idx ON songs (album, album_order);
CREATE INDEX songs_album_slug_idx  ON songs (album_slug);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER songs_set_updated_at
BEFORE UPDATE ON songs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE songs ENABLE ROW LEVEL SECURITY;

CREATE POLICY songs_public_read ON songs
  FOR SELECT
  USING (true);

-- NOTE: writes go through the service role / postgres role via the pooler,
-- both of which bypass RLS. No INSERT/UPDATE/DELETE policy is needed.
