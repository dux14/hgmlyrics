-- song_audio: mp3 completo por cancion (1:1). Bucket privado 'song-audio' (ya
-- creado en 20260707120000_song_section_audio.sql), key server-side
-- '<songId>/full.mp3'. Escrituras solo service role. song_id es TEXT porque
-- songs.id lo es (ver 0001_initial.sql).
CREATE TABLE song_audio (
  song_id      TEXT PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
  storage_key  TEXT NOT NULL,
  duration_sec NUMERIC,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- song_line_timings: resultado del forced alignment (1:1 con cancion).
-- lines: [{"i":0,"startMs":12040}, ...] -- i = indice en la proyeccion
-- canonica (modo letra, annotation saltadas). Espacio futuro: words por linea.
CREATE TABLE song_line_timings (
  song_id    TEXT PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','ready','failed','stale')),
  lines      JSONB,
  provider   TEXT,
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE song_audio        ENABLE ROW LEVEL SECURITY;
ALTER TABLE song_line_timings ENABLE ROW LEVEL SECURITY;

-- Lectura para usuarios autenticados (como songs); escritura solo service role.
CREATE POLICY song_audio_read ON song_audio
  FOR SELECT TO authenticated USING (true);
CREATE POLICY song_line_timings_read ON song_line_timings
  FOR SELECT TO authenticated USING (true);

-- set_updated_at ya existe en el esquema (0001_initial.sql); reusar la funcion.
CREATE TRIGGER song_audio_updated_at
  BEFORE UPDATE ON song_audio
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER song_line_timings_updated_at
  BEFORE UPDATE ON song_line_timings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO feature_flags (key, description) VALUES
  ('immersive_player', 'Player de pista completa en la vista inmersiva (play/pausa/scrubber)')
ON CONFLICT (key) DO NOTHING;
