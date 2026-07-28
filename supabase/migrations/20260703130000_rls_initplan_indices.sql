-- Performance: envolver auth.uid() en (select auth.uid()) para que el planner
-- lo evalue una sola vez (InitPlan) en vez de por fila. Fix #1 de RLS de Supabase.
-- Ademas: indice FK favorites(song_id), drop del indice redundante
-- favorites_user_id_idx, indice friendships(addressee_id, status), y re-pin del
-- search_path en dos funciones que lo perdieron por un CREATE OR REPLACE previo.

-- === RLS: (select auth.uid()) en las 21 policies que usan auth.uid() ===

-- ephemeral_list_items
ALTER POLICY list_items_select ON public.ephemeral_list_items
  USING (EXISTS ( SELECT 1 FROM ephemeral_lists l
    WHERE l.id = ephemeral_list_items.list_id
      AND ((l.owner_id = (select auth.uid())) OR is_list_member(l.id))));

ALTER POLICY list_items_write ON public.ephemeral_list_items
  USING (EXISTS ( SELECT 1 FROM ephemeral_lists l
    WHERE l.id = ephemeral_list_items.list_id AND l.owner_id = (select auth.uid())))
  WITH CHECK (EXISTS ( SELECT 1 FROM ephemeral_lists l
    WHERE l.id = ephemeral_list_items.list_id AND l.owner_id = (select auth.uid())));

-- ephemeral_list_members
ALTER POLICY list_members_select ON public.ephemeral_list_members
  USING (EXISTS ( SELECT 1 FROM ephemeral_lists l
    WHERE l.id = ephemeral_list_members.list_id
      AND ((l.owner_id = (select auth.uid()))
        OR (l.id IN ( SELECT ephemeral_list_members_1.list_id
             FROM ephemeral_list_members ephemeral_list_members_1
             WHERE ephemeral_list_members_1.user_id = (select auth.uid()))))));

ALTER POLICY list_members_write ON public.ephemeral_list_members
  USING (EXISTS ( SELECT 1 FROM ephemeral_lists l
    WHERE l.id = ephemeral_list_members.list_id AND l.owner_id = (select auth.uid())))
  WITH CHECK (EXISTS ( SELECT 1 FROM ephemeral_lists l
    WHERE l.id = ephemeral_list_members.list_id AND l.owner_id = (select auth.uid())));

-- ephemeral_lists
ALTER POLICY lists_delete_own ON public.ephemeral_lists
  USING ((select auth.uid()) = owner_id);
ALTER POLICY lists_insert_own ON public.ephemeral_lists
  WITH CHECK ((select auth.uid()) = owner_id);
ALTER POLICY lists_select ON public.ephemeral_lists
  USING (((select auth.uid()) = owner_id) OR is_list_member(id));
ALTER POLICY lists_update_own ON public.ephemeral_lists
  USING ((select auth.uid()) = owner_id);

-- favorites
ALTER POLICY favorites_delete_own ON public.favorites
  USING ((select auth.uid()) = user_id);
ALTER POLICY favorites_insert_own ON public.favorites
  WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY favorites_select ON public.favorites
  USING ((((select auth.uid()) = user_id) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = favorites.user_id) AND ((p.is_public = true) OR (EXISTS ( SELECT 1
           FROM friendships
          WHERE ((friendships.status = 'accepted'::text) AND (((friendships.requester_id = (select auth.uid())) AND (friendships.addressee_id = p.id)) OR ((friendships.requester_id = p.id) AND (friendships.addressee_id = (select auth.uid())))))))))))));

-- friendships
ALTER POLICY friendships_delete_either ON public.friendships
  USING (((select auth.uid()) = requester_id) OR ((select auth.uid()) = addressee_id));
ALTER POLICY friendships_insert_as_requester ON public.friendships
  WITH CHECK ((select auth.uid()) = requester_id);
ALTER POLICY friendships_select_participant ON public.friendships
  USING (((select auth.uid()) = requester_id) OR ((select auth.uid()) = addressee_id));
ALTER POLICY friendships_update_addressee ON public.friendships
  USING (((select auth.uid()) = addressee_id) AND (status = 'pending'::text))
  WITH CHECK ((select auth.uid()) = addressee_id);

-- profiles
ALTER POLICY profiles_delete_own ON public.profiles
  USING ((select auth.uid()) = id);
ALTER POLICY profiles_select ON public.profiles
  USING (((select auth.uid()) = id) OR (is_public = true) OR (EXISTS ( SELECT 1 FROM friendships
    WHERE friendships.status = 'accepted'::text
      AND (((friendships.requester_id = (select auth.uid())) AND (friendships.addressee_id = profiles.id))
        OR ((friendships.requester_id = profiles.id) AND (friendships.addressee_id = (select auth.uid())))))));
ALTER POLICY profiles_update_own ON public.profiles
  USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);

-- songs
ALTER POLICY songs_authenticated_read ON public.songs
  USING ((select auth.uid()) IS NOT NULL);

-- world_avatars
ALTER POLICY world_avatars_insert ON public.world_avatars
  WITH CHECK ((select auth.uid()) = uid);
ALTER POLICY world_avatars_update ON public.world_avatars
  USING ((select auth.uid()) = uid)
  WITH CHECK ((select auth.uid()) = uid);

-- === Indices ===
-- FK favorites.song_id sin indice lider -> seq scan en DELETE FROM songs (CASCADE).
CREATE INDEX IF NOT EXISTS favorites_song_id_idx ON public.favorites (song_id);
-- Redundante: el PK (user_id, song_id) ya cubre lookups por user_id lider.
DROP INDEX IF EXISTS public.favorites_user_id_idx;
-- Lookups de "amistades aceptadas donde soy addressee" fuera del caso pending.
CREATE INDEX IF NOT EXISTS friendships_addressee_status_idx
  ON public.friendships (addressee_id, status);

-- === Re-pin search_path (regresion del advisor 0011) ===
ALTER FUNCTION public.set_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.ephemeral_lists_depth_guard() SET search_path = pg_catalog, public;
