-- supabase/migrations/20260616000000_weekly_words.sql
-- Tabla de voces en off semanales. Snapshot por domingo; no depende de la API
-- del ordo en tiempo de lectura.

CREATE TABLE weekly_words (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  sunday_date      date         NOT NULL UNIQUE,
  gospel_ref       text         NOT NULL,
  liturgical_title text,
  liturgical_color text,        -- 'green'|'purple'|'white'|'red'
  voiceover_body   text         NOT NULL,
  gospel_body      text,
  published        boolean      NOT NULL DEFAULT false,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now()
);

-- RLS: lectura pública solo de publicadas; escritura solo admin (service role).
ALTER TABLE weekly_words ENABLE ROW LEVEL SECURITY;

CREATE POLICY weekly_words_public_read ON weekly_words
  FOR SELECT TO authenticated
  USING (published = true);

-- El backend usa DATABASE_URL (postgres owner, bypasses RLS) para escrituras.
-- No hay policy de INSERT/UPDATE/DELETE para el rol authenticated.
