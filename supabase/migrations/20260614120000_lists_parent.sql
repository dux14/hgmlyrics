-- lists_parent.sql — jerarquía de 2 niveles para listas efímeras (eventos → sub-listas)

ALTER TABLE ephemeral_lists
  ADD COLUMN parent_id uuid NULL
    REFERENCES ephemeral_lists(id) ON DELETE CASCADE;

CREATE INDEX ephemeral_lists_parent_idx
  ON ephemeral_lists (parent_id, expires_at)
  WHERE parent_id IS NOT NULL;

-- Defensa en profundidad: un hijo no puede ser padre (profundidad máx. 2).
-- Se valida también en el API; este trigger es la red de seguridad a nivel DB.
CREATE OR REPLACE FUNCTION ephemeral_lists_depth_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    -- El padre propuesto debe ser raíz (profundidad 1)
    IF EXISTS (SELECT 1 FROM ephemeral_lists
               WHERE id = NEW.parent_id AND parent_id IS NOT NULL) THEN
      RAISE EXCEPTION 'No se puede anidar más de 2 niveles';
    END IF;
    -- El nodo que se vuelve hijo no puede tener hijos propios
    IF EXISTS (SELECT 1 FROM ephemeral_lists WHERE parent_id = NEW.id) THEN
      RAISE EXCEPTION 'Un nodo con hijos no puede convertirse en hijo';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ephemeral_lists_depth_guard_trg
  BEFORE INSERT OR UPDATE OF parent_id ON ephemeral_lists
  FOR EACH ROW EXECUTE FUNCTION ephemeral_lists_depth_guard();
