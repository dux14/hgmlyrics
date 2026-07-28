-- Partitura vocal: jobs del pipeline letra↔nota (efímeros, 48h). Flujo propio,
-- independiente de stem_jobs. Solo el service role toca esta tabla.
CREATE TABLE pitch_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sha256        text,
  status        text NOT NULL DEFAULT 'created'
                CHECK (status IN ('created','uploaded','estimating','awaiting_approval',
                                  'running','succeeded','partial','failed','cancelled','expired')),
  profile       text NOT NULL DEFAULT 'oss' CHECK (profile IN ('oss','precision')),
  duration_sec  real,
  cost_estimate_lo real,
  cost_estimate_hi real,
  cost_actual   real,
  input_path    text,
  input_meta    jsonb,
  phases        jsonb NOT NULL DEFAULT '{}'::jsonb,
  artifacts     jsonb NOT NULL DEFAULT '[]'::jsonb,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz
);

CREATE INDEX pitch_jobs_user_created_idx ON pitch_jobs (user_id, created_at DESC);
CREATE INDEX pitch_jobs_status_idx ON pitch_jobs (status);
CREATE INDEX pitch_jobs_expires_idx ON pitch_jobs (expires_at) WHERE status = 'succeeded';
CREATE INDEX pitch_jobs_in_progress_idx ON pitch_jobs (updated_at) WHERE status = 'running';

-- Un solo job "en curso" por usuario (gate de cuota a nivel BD, cierra el TOCTOU).
CREATE UNIQUE INDEX pitch_jobs_one_active_per_user ON pitch_jobs (user_id)
  WHERE status IN ('created','uploaded','estimating','awaiting_approval','running');

-- Idempotencia: un resultado por (sha256, profile) exitoso.
CREATE UNIQUE INDEX pitch_jobs_sha_profile_done ON pitch_jobs (sha256, profile)
  WHERE status = 'succeeded' AND sha256 IS NOT NULL;

-- Trigger updated_at con search_path fijo (evita la regresión de set_updated_at global).
CREATE OR REPLACE FUNCTION pitch_set_updated_at()
  RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER pitch_jobs_set_updated_at
  BEFORE UPDATE ON pitch_jobs
  FOR EACH ROW EXECUTE FUNCTION pitch_set_updated_at();

ALTER TABLE pitch_jobs ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public)
VALUES ('pitch-jobs', 'pitch-jobs', false)
ON CONFLICT (id) DO NOTHING;

UPDATE storage.buckets
  SET file_size_limit = 26214400,
      allowed_mime_types = ARRAY['audio/mpeg','audio/wav','audio/x-wav','audio/wave',
        'audio/mp4','audio/m4a','audio/x-m4a','audio/aac','audio/flac','audio/ogg']
  WHERE id = 'pitch-jobs';

-- Flag de acceso beta a Partitura vocal (permite abrir la beta sin migración extra).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pitch_beta boolean NOT NULL DEFAULT false;
