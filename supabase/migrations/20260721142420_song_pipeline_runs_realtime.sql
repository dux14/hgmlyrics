-- Pipeline unificado (Task D1): broadcast de Realtime para song_pipeline_runs.
-- Calca el patrón de stem_jobs_broadcast_status (20260611120100 +
-- 20260615120100, con search_path fijo desde el inicio para no reabrir el
-- hijacking de SEC-12): topic por canción (una canción tiene a lo sumo un run
-- activo), payload mínimo (runId + status) porque el cliente re-fetchea el run
-- completo vía GET /api/songs/:id/pipeline al recibir la señal.
--
-- Broadcast PÚBLICO (private=false), igual que stems. A diferencia de stems
-- (topic con UUID no-adivinable), acá el topic lleva song_id (slug público
-- enumerable): un visitante no autenticado podría observar las transiciones de
-- estado del run. Tradeoff aceptado — el payload solo lleva runId + status (sin
-- contenido sensible) y la API del run sigue gated por requireAdmin.
CREATE OR REPLACE FUNCTION song_pipeline_runs_broadcast_status()
  RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, realtime
AS $$
BEGIN
  -- Solo emitimos la señal cuando cambia algo que el stepper del front observa:
  -- el status global del run o el jsonb de fases (display progresivo: pistas y
  -- fases publicándose apenas terminan). Las ediciones del gate de letra
  -- (UPDATE de lyrics_review) y los touches de solo updated_at NO disparan
  -- broadcast, para no generar refetch-churn durante la revisión de letra (cada
  -- acción del gate es un UPDATE de lyrics_review). El OR corto-circuita en
  -- INSERT antes de tocar OLD (null en INSERT).
  IF TG_OP = 'INSERT'
     OR OLD.status IS DISTINCT FROM NEW.status
     OR OLD.phases IS DISTINCT FROM NEW.phases THEN
    PERFORM realtime.send(
      jsonb_build_object('runId', NEW.id, 'status', NEW.status),
      'change',
      'pipeline:run:' || NEW.song_id::text,
      false
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS song_pipeline_runs_broadcast_status_trg ON song_pipeline_runs;

CREATE TRIGGER song_pipeline_runs_broadcast_status_trg
  AFTER INSERT OR UPDATE ON song_pipeline_runs
  FOR EACH ROW
  EXECUTE FUNCTION song_pipeline_runs_broadcast_status();
