-- Respaldo de una sola ranura para deshacer un realineado de tiempos.
-- Se llena al disparar el realineado y lo borra cualquier escritura posterior
-- del documento (ver api/_lib/pipeline/lyricsStore.js).
alter table song_pipeline_lyrics
  add column if not exists previous_sections jsonb,
  add column if not exists previous_hash text,
  add column if not exists realigned_at timestamptz;
