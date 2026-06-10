-- Estudio: empuja el cambio de estado del job vía Realtime Broadcast.
-- Canal público 'stems:job:{id}' (UUID no-adivinable); payload solo el estado,
-- nada sensible. Los datos reales siguen saliendo por la API autenticada/saneada.
CREATE OR REPLACE FUNCTION stem_jobs_broadcast_status()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('status', NEW.status),
    'status',
    'stems:job:' || NEW.id::text,
    false
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER stem_jobs_broadcast_status_trg
  AFTER UPDATE OF status ON stem_jobs
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION stem_jobs_broadcast_status();
