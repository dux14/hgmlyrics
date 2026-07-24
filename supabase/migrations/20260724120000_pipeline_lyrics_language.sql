-- Idioma de la letra aprobada en el gate del pipeline.
-- Lo elige el admin y viaja a hkn-pitch junto con las lineas aprobadas:
-- sin transcribe no hay autodeteccion de idioma en la fase pitch.
ALTER TABLE song_pipeline_lyrics
  ADD COLUMN language text NOT NULL DEFAULT 'es'
  CHECK (language IN ('es', 'en'));
