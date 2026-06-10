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

-- Solo el service role toca esta tabla (los endpoints usan el pooler con service key).
ALTER TABLE stem_jobs ENABLE ROW LEVEL SECURITY;

-- Bucket privado para inputs y resultados
INSERT INTO storage.buckets (id, name, public)
VALUES ('stems-jobs', 'stems-jobs', false)
ON CONFLICT (id) DO NOTHING;

-- Subida directa desde el browser SOLO vía signed upload URL (no se necesita policy de INSERT
-- para authenticated: uploadToSignedUrl usa el token firmado emitido por el service role).
