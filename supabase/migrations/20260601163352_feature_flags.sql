-- feature_flags.sql
-- Feature flags por usuario (email o username). Writes vía service role (bypass RLS).

CREATE TABLE feature_flags (
  key            TEXT PRIMARY KEY,
  description    TEXT,
  enabled_global BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE feature_flag_users (
  flag_key   TEXT NOT NULL REFERENCES feature_flags(key) ON DELETE CASCADE,
  email      TEXT,
  username   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR username IS NOT NULL),
  PRIMARY KEY (flag_key, email, username)
);

CREATE INDEX feature_flag_users_email_lower_idx
  ON feature_flag_users (lower(email));
CREATE INDEX feature_flag_users_username_lower_idx
  ON feature_flag_users (lower(username));

ALTER TABLE feature_flags      ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flag_users ENABLE ROW LEVEL SECURITY;

-- Lectura pública del catálogo (no expone asignaciones). Writes vía service role.
CREATE POLICY feature_flags_read ON feature_flags
  FOR SELECT USING (true);

-- Asignaciones: NO lectura pública (contienen emails). Solo service role accede.
-- (Sin policy SELECT → nadie con anon/auth puede leer; service role bypassa RLS.)

-- Seed inicial de los flags de la iniciativa.
INSERT INTO feature_flags (key, description) VALUES
  ('voz_tono',          'Capa de voces/tonos y notas por sílaba'),
  ('afinador_shortcut', 'Atajo al afinador desde la voz activa')
ON CONFLICT (key) DO NOTHING;
