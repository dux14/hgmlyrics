-- ephemeral_lists.sql — Listas efímeras tipo álbum (dueño + caducidad + invitados RO)

CREATE TABLE ephemeral_lists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ephemeral_lists_owner_idx   ON ephemeral_lists (owner_id);
CREATE INDEX ephemeral_lists_expires_idx ON ephemeral_lists (expires_at);

CREATE TRIGGER ephemeral_lists_set_updated_at
  BEFORE UPDATE ON ephemeral_lists
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE ephemeral_list_songs (
  list_id   uuid NOT NULL REFERENCES ephemeral_lists(id) ON DELETE CASCADE,
  song_id   text NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  position  int  NOT NULL,
  PRIMARY KEY (list_id, song_id)
);
CREATE INDEX ephemeral_list_songs_order_idx ON ephemeral_list_songs (list_id, position);

CREATE TABLE ephemeral_list_members (
  list_id    uuid NOT NULL REFERENCES ephemeral_lists(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, user_id)
);
CREATE INDEX ephemeral_list_members_user_idx ON ephemeral_list_members (user_id);

-- ===== RLS (defensa en profundidad; el backend usa service role) =====
ALTER TABLE ephemeral_lists        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ephemeral_list_songs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ephemeral_list_members ENABLE ROW LEVEL SECURITY;

-- Helper: ¿auth.uid() es miembro de la lista?
CREATE OR REPLACE FUNCTION is_list_member(lst uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM ephemeral_list_members m
                 WHERE m.list_id = lst AND m.user_id = auth.uid());
$$;

CREATE POLICY lists_select ON ephemeral_lists FOR SELECT
  USING (auth.uid() = owner_id OR is_list_member(id));
CREATE POLICY lists_insert_own ON ephemeral_lists FOR INSERT
  WITH CHECK (auth.uid() = owner_id);
CREATE POLICY lists_update_own ON ephemeral_lists FOR UPDATE
  USING (auth.uid() = owner_id);
CREATE POLICY lists_delete_own ON ephemeral_lists FOR DELETE
  USING (auth.uid() = owner_id);

CREATE POLICY list_songs_select ON ephemeral_list_songs FOR SELECT
  USING (EXISTS (SELECT 1 FROM ephemeral_lists l WHERE l.id = list_id
                 AND (l.owner_id = auth.uid() OR is_list_member(l.id))));
CREATE POLICY list_songs_write ON ephemeral_list_songs FOR ALL
  USING (EXISTS (SELECT 1 FROM ephemeral_lists l WHERE l.id = list_id AND l.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM ephemeral_lists l WHERE l.id = list_id AND l.owner_id = auth.uid()));

CREATE POLICY list_members_select ON ephemeral_list_members FOR SELECT
  USING (EXISTS (SELECT 1 FROM ephemeral_lists l WHERE l.id = list_id
                 AND (l.owner_id = auth.uid() OR l.id IN
                      (SELECT list_id FROM ephemeral_list_members WHERE user_id = auth.uid())))) ;
CREATE POLICY list_members_write ON ephemeral_list_members FOR ALL
  USING (EXISTS (SELECT 1 FROM ephemeral_lists l WHERE l.id = list_id AND l.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM ephemeral_lists l WHERE l.id = list_id AND l.owner_id = auth.uid()));
