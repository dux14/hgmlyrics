-- Entrega 2 (retry automatico transversal): columnas del circuit breaker por
-- run y del reintento diferido. Aditiva, tolera filas viejas: el codigo lee
-- `phases.<fase>.autoRetries` con `|| 0` (mismo trato que `retries` hoy), asi
-- que `phases` (jsonb) no necesita migracion.
ALTER TABLE song_pipeline_runs
  ADD COLUMN IF NOT EXISTS auto_retries integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;

-- Indice parcial: el cron de limpieza barre por esta columna cada hora
-- buscando reintentos diferidos pendientes.
CREATE INDEX IF NOT EXISTS song_pipeline_runs_next_retry_at_idx
  ON song_pipeline_runs (next_retry_at) WHERE next_retry_at IS NOT NULL;
