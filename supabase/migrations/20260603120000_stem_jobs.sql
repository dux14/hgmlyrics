-- Estudio de pistas: jobs de separación de stems/voces (efímeros, 48h)
CREATE TABLE stem_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'created'
              CHECK (status IN ('created','uploaded','separating_stems','separating_voices','done','failed','expired')),
  input_path  text,
  input_meta  jsonb,
  stems       jsonb,
  voices      jsonb,
  predictions jsonb NOT NULL DEFAULT '{}'::jsonb,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz
);

CREATE INDEX stem_jobs_user_created_idx ON stem_jobs (user_id, created_at DESC);
CREATE INDEX stem_jobs_status_idx ON stem_jobs (status);

-- Índices parciales para el cron de limpieza y reconciliación
CREATE INDEX stem_jobs_expires_idx ON stem_jobs (expires_at) WHERE status = 'done';
CREATE INDEX stem_jobs_in_progress_updated_idx ON stem_jobs (updated_at) WHERE status IN ('separating_stems','separating_voices');

-- Trigger para mantener updated_at al día automáticamente
CREATE OR REPLACE FUNCTION set_updated_at()
  RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER stem_jobs_set_updated_at
  BEFORE UPDATE ON stem_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Solo el service role toca esta tabla (los endpoints usan el pooler con service key).
ALTER TABLE stem_jobs ENABLE ROW LEVEL SECURITY;

-- Bucket privado para inputs y resultados
INSERT INTO storage.buckets (id, name, public)
VALUES ('stems-jobs', 'stems-jobs', false)
ON CONFLICT (id) DO NOTHING;

-- Tope de tamaño y MIME permitidos (25 MB; tipos aceptados por validateUploadMeta en api/_lib/stems.js)
UPDATE storage.buckets
  SET file_size_limit = 26214400,
      allowed_mime_types = ARRAY[
        'audio/mpeg',
        'audio/wav',
        'audio/x-wav',
        'audio/wave',
        'audio/mp4',
        'audio/m4a',
        'audio/x-m4a',
        'audio/aac',
        'audio/flac',
        'audio/ogg'
      ]
  WHERE id = 'stems-jobs';

-- Subida directa desde el browser SOLO vía signed upload URL (no se necesita policy de INSERT
-- para authenticated: uploadToSignedUrl usa el token firmado emitido por el service role).
