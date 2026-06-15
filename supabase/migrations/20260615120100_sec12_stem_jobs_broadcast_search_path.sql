-- SEC-12: Fijar search_path en función SECURITY DEFINER stem_jobs_broadcast_status.
--
-- Situación original: la función usaba SECURITY DEFINER sin SET search_path,
-- lo que la hace vulnerable a search_path hijacking (un atacante con permisos
-- para crear objetos en un schema puede shadowing realtime.send u otras funciones
-- resueltas al momento de ejecución).
--
-- La versión vigente es la de 20260611120100_stem_jobs_section_broadcast.sql
-- (incluye 'sections' en el payload). Se reproduce el cuerpo exacto añadiendo
-- SET search_path = pg_catalog, public, realtime para que realtime.send resuelva
-- correctamente y el resto del código no cambie.

CREATE OR REPLACE FUNCTION stem_jobs_broadcast_status()
  RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, realtime
AS $$
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
