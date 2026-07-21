-- Pipeline unificado (Task D1): broadcast de Realtime para song_pipeline_runs.
-- Calca el patron de stem_jobs_broadcast_status (20260611120100 +
-- 20260615120100, con search_path fijo desde el inicio para no reabrir el
-- hijacking de SEC-12): topic por cancion (una cancion tiene a lo sumo un run
-- activo), payload minimo (runId + status) porque el cliente re-fetchea el
-- run completo via GET /api/songs/:id/pipeline al recibir la senal.
CREATE OR REPLACE FUNCTION song_pipeline_runs_broadcast_status()
  RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, realtime
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('runId', NEW.id, 'status', NEW.status),
    'change',
    'pipeline:run:' || NEW.song_id::text,
    false
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS song_pipeline_runs_broadcast_status_trg ON song_pipeline_runs;

CREATE TRIGGER song_pipeline_runs_broadcast_status_trg
  AFTER INSERT OR UPDATE ON song_pipeline_runs
  FOR EACH ROW
  EXECUTE FUNCTION song_pipeline_runs_broadcast_status();
