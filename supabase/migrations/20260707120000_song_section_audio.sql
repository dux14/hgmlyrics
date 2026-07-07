-- Audio por sección (F4, spec vista-cancion-refactor D4): mp3 propios subidos por
-- admin (o promovidos desde el Estudio en fase posterior) para reproducir dentro de
-- la vista de canción. song_id es TEXT porque songs.id lo es (ver 0001_initial.sql).
CREATE TABLE song_section_audio (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id        text NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  section_index  int NOT NULL CHECK (section_index >= 0),
  -- NULL = mezcla completa; si no, categoría de voz (soprano/contralto/tenor/bass,
  -- o lead/backing como en el Estudio — ver CANONICAL_VOICE_ORDER en voiceSystem.js).
  voice_scope    text NULL,
  storage_key    text NOT NULL,
  label          text NULL,
  duration_sec   numeric NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Único índice necesario: cubre tanto el lookup por (song_id, section_index) del GET
-- como la unicidad de (song_id, section_index, voice_scope) que exige el UPSERT del
-- POST. coalesce(voice_scope,'') porque NULL no es comparable en una UNIQUE plana.
CREATE UNIQUE INDEX song_section_audio_unique_idx
  ON song_section_audio (song_id, section_index, coalesce(voice_scope, ''));

ALTER TABLE song_section_audio ENABLE ROW LEVEL SECURITY;

-- SELECT para authenticated (la app es privada tras login; mismo patrón que
-- song_platform_links/song_voice_links tras SEC-06). INSERT/UPDATE/DELETE solo
-- vía service role: los endpoints admin usan sql (postgres.js, DATABASE_URL) que
-- se ejecuta como owner y omite RLS, igual que stem_jobs — sin policies de escritura.
CREATE POLICY song_section_audio_auth_read ON song_section_audio
  FOR SELECT TO authenticated USING (true);

-- Bucket privado para los mp3 de sección. Sin acceso público: todo se sirve por
-- signed URL (signSongAudioDownload), igual que stems-jobs/pitch-jobs.
INSERT INTO storage.buckets (id, name, public)
VALUES ('song-audio', 'song-audio', false)
ON CONFLICT (id) DO NOTHING;

-- Lección pitch (20260706120000): NO restringir allowed_mime_types de más — el
-- browser/cliente que hace el PUT firmado puede mandar un content-type que el
-- bucket rechace si se fija una lista. Solo se limita el tamaño (25MB).
UPDATE storage.buckets
  SET file_size_limit = 26214400,
      allowed_mime_types = NULL
  WHERE id = 'song-audio';
