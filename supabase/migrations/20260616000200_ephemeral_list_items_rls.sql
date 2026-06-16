-- supabase/migrations/20260616000200_ephemeral_list_items_rls.sql
-- RLS para ephemeral_list_items (defensa en profundidad; el backend usa
-- service role / postgres owner que bypassa RLS). Réplica de las policies que
-- tenía ephemeral_list_songs antes de la migración polimórfica.
-- El helper is_list_member(uuid) ya existe (creado en 20260610120000).

ALTER TABLE ephemeral_list_items ENABLE ROW LEVEL SECURITY;

-- SELECT: owner de la lista o miembro.
CREATE POLICY list_items_select ON ephemeral_list_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM ephemeral_lists l WHERE l.id = list_id
                 AND (l.owner_id = auth.uid() OR is_list_member(l.id))));

-- Escritura (INSERT/UPDATE/DELETE): solo el owner de la lista.
CREATE POLICY list_items_write ON ephemeral_list_items FOR ALL
  USING (EXISTS (SELECT 1 FROM ephemeral_lists l WHERE l.id = list_id AND l.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM ephemeral_lists l WHERE l.id = list_id AND l.owner_id = auth.uid()));
