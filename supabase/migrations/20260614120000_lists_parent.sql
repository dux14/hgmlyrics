-- lists_parent.sql — jerarquía de 2 niveles para listas efímeras (eventos → sub-listas)

ALTER TABLE ephemeral_lists
  ADD COLUMN parent_id uuid NULL
    REFERENCES ephemeral_lists(id) ON DELETE CASCADE;

CREATE INDEX ephemeral_lists_parent_idx ON ephemeral_lists (parent_id);

-- Defensa en profundidad: un hijo no puede ser padre (profundidad máx. 2).
-- Se valida también en el API; este trigger es la red de seguridad a nivel DB.
CREATE OR REPLACE FUNCTION ephemeral_lists_depth_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM ephemeral_lists p
               WHERE p.id = NEW.parent_id AND p.parent_id IS NOT NULL) THEN
      RAISE EXCEPTION 'No se puede anidar más de 2 niveles';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ephemeral_lists_depth_guard_trg
  BEFORE INSERT OR UPDATE OF parent_id ON ephemeral_lists
  FOR EACH ROW EXECUTE FUNCTION ephemeral_lists_depth_guard();
