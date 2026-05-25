-- Song platform links (YouTube, Spotify, Apple Music, etc.)
CREATE TABLE song_platform_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id     TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  platform    TEXT NOT NULL,
  url         TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX song_platform_links_song_id_idx ON song_platform_links (song_id);

-- Voice drive links (one or more per voice type per song)
CREATE TABLE song_voice_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id     TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  voice_type  TEXT NOT NULL,
  url         TEXT NOT NULL,
  label       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX song_voice_links_song_id_idx ON song_voice_links (song_id);

-- RLS: public read
ALTER TABLE song_platform_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE song_voice_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY song_platform_links_public_read ON song_platform_links
  FOR SELECT USING (true);

CREATE POLICY song_voice_links_public_read ON song_voice_links
  FOR SELECT USING (true);
