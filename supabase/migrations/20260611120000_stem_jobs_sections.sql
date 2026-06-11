-- Estudio 4 secciones: estado por sección + enum de status ampliado.
-- Los valores 'separating_stems' y 'separating_voices' quedan obsoletos;
-- el nuevo valor 'processing' los reemplaza (genérico para cualquier sección).
-- 'partial' indica que al menos una sección terminó pero no todas.

-- 1. Nuevo CHECK de status (superset que sustituye el inline CHECK de la columna).
--    Nombre convencional de Postgres para inline CHECK: stem_jobs_status_check.
ALTER TABLE stem_jobs DROP CONSTRAINT IF EXISTS stem_jobs_status_check;
ALTER TABLE stem_jobs ADD CONSTRAINT stem_jobs_status_check
  CHECK (status IN ('created','uploaded','processing','done','partial','failed','expired'));

-- 2. Columnas nuevas (aditivas, con DEFAULT → backward-compatible con filas viejas).
ALTER TABLE stem_jobs ADD COLUMN IF NOT EXISTS sections        jsonb  NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE stem_jobs ADD COLUMN IF NOT EXISTS enabled_sections text[] NOT NULL DEFAULT '{}';

-- 3. Las columnas stems/voices ya son nullable en el esquema original;
--    se incluyen como defensa por si alguna réplica/dump las creó con NOT NULL.
ALTER TABLE stem_jobs ALTER COLUMN stems  DROP NOT NULL;
ALTER TABLE stem_jobs ALTER COLUMN voices DROP NOT NULL;

-- 4. Recrear el índice parcial de jobs en-progreso para el nuevo status.
--    El índice antiguo filtraba por 'separating_stems'/'separating_voices';
--    esos valores ya no pueden existir (el CHECK los rechaza), así que el índice
--    sería letra muerta. Se reemplaza por el filtro genérico 'processing'.
DROP INDEX IF EXISTS stem_jobs_in_progress_updated_idx;
CREATE INDEX stem_jobs_in_progress_updated_idx
  ON stem_jobs (updated_at)
  WHERE status = 'processing';
