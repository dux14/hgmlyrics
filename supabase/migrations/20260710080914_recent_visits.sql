-- recent_visits: historial de canciones visitadas, ligado a la cuenta.
-- Una fila por (user_id, song_id); cada visita hace upsert de visited_at,
-- así el tamaño por usuario queda acotado por el catálogo (sin poda).

CREATE TABLE recent_visits (
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  song_id    TEXT NOT NULL REFERENCES songs(id)    ON DELETE CASCADE,
  visited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, song_id)
);

CREATE INDEX recent_visits_user_visited_idx
  ON recent_visits (user_id, visited_at DESC);

-- Cubre el FK song_id para que ON DELETE CASCADE desde songs no haga seq scan
-- (mismo patrón que favorites_song_id_idx en 20260703130000).
CREATE INDEX recent_visits_song_id_idx ON recent_visits (song_id);

-- RLS: el historial es privado — solo el dueño, sin visibilidad social
-- (a diferencia de favorites, que expone a amigos/perfil público).
ALTER TABLE recent_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY recent_visits_select_own ON recent_visits FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY recent_visits_insert_own ON recent_visits FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

-- El upsert (ON CONFLICT DO UPDATE) necesita política de UPDATE además de INSERT.
CREATE POLICY recent_visits_update_own ON recent_visits FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY recent_visits_delete_own ON recent_visits FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);
