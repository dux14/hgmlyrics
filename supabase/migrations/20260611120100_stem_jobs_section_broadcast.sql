-- Estudio: amplía el broadcast de Realtime para incluir `sections` en el payload
-- y para que el trigger dispare también cuando cambia la columna `sections`.
-- Esto es necesario porque el front revela cada una de las 4 tarjetas de sección
-- a medida que completan (pending→running→done) mientras el job-level `status`
-- permanece en 'processing' — sin este cambio esas actualizaciones por sección
-- nunca llegarían al cliente.
-- Se mantiene el mismo nombre de función, canal, evento y flag private=false
-- para que la suscripción existente del front siga funcionando sin modificación.
CREATE OR REPLACE FUNCTION stem_jobs_broadcast_status()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('status', NEW.status, 'sections', NEW.sections),
    'status',
    'stems:job:' || NEW.id::text,
    false
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stem_jobs_broadcast_status_trg ON stem_jobs;

CREATE TRIGGER stem_jobs_broadcast_status_trg
  AFTER UPDATE OF status, sections ON stem_jobs
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.sections IS DISTINCT FROM NEW.sections)
  EXECUTE FUNCTION stem_jobs_broadcast_status();
