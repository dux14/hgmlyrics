-- Tabla de respaldo del contenido de canciones antes de sobreescribir con texto del PDF (ITER 1 acordes).
-- Permite revertir un apply: UPDATE songs SET sections=b.sections ... FROM songs_lyrics_backup b.
CREATE TABLE IF NOT EXISTS songs_lyrics_backup (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  song_id      TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  sections     JSONB NOT NULL,
  key          TEXT,
  cejilla      INTEGER,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS songs_lyrics_backup_song_idx
  ON songs_lyrics_backup (song_id, backed_up_at DESC);

-- Solo el service role accede (los scripts usan DATABASE_URL/service role).
ALTER TABLE songs_lyrics_backup ENABLE ROW LEVEL SECURITY;
