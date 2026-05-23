-- 0005_auth_profile_social.sql
-- PR2: Supabase Auth (Google + magic link) + perfiles + favoritas + social mínimo.
-- Pre-condición: Supabase Auth ya habilitado en el proyecto (auth.users existe).
-- Post-condición: lectura de `songs` requiere sesión autenticada (anula RLS public_read).

-- =============================================================
-- 1. profiles (1 row por usuario en auth.users)
-- =============================================================
CREATE TABLE profiles (
  id                uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username          TEXT UNIQUE,
  display_name      TEXT,
  bio               TEXT CHECK (bio IS NULL OR char_length(bio) <= 200),
  avatar_url        TEXT,
  voice_type        TEXT CHECK (voice_type IS NULL OR voice_type IN ('soprano','contralto','tenor','bass')),
  voice_subtype     TEXT CHECK (voice_subtype IS NULL OR voice_subtype IN ('alta','baja')),
  vocal_range_low   TEXT CHECK (vocal_range_low IS NULL OR vocal_range_low ~ '^[A-G][#b]?[0-7]$'),
  vocal_range_high  TEXT CHECK (vocal_range_high IS NULL OR vocal_range_high ~ '^[A-G][#b]?[0-7]$'),
  instrument_roles  TEXT[] NOT NULL DEFAULT '{}',
  is_admin          BOOLEAN NOT NULL DEFAULT false,
  is_public         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX profiles_username_lower_idx     ON profiles (lower(username));
CREATE INDEX profiles_display_name_lower_idx ON profiles (lower(display_name));

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================
-- 2. favorites
-- =============================================================
CREATE TABLE favorites (
  user_id     uuid REFERENCES profiles(id) ON DELETE CASCADE,
  song_id     TEXT REFERENCES songs(id)    ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, song_id)
);

CREATE INDEX favorites_user_id_idx ON favorites (user_id);

-- =============================================================
-- 3. friendships
-- =============================================================
CREATE TABLE friendships (
  requester_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  addressee_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN ('pending','accepted','blocked')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);

CREATE INDEX friendships_addressee_pending_idx
  ON friendships (addressee_id) WHERE status = 'pending';

CREATE TRIGGER friendships_set_updated_at
  BEFORE UPDATE ON friendships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================
-- 4. Trigger: auto-crear profile al signup
-- =============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- =============================================================
-- 5. Cambiar RLS de songs: ya NO es lectura pública
-- =============================================================
DROP POLICY IF EXISTS songs_public_read ON songs;
CREATE POLICY songs_authenticated_read ON songs FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- =============================================================
-- 6. RLS — profiles
-- =============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select ON profiles FOR SELECT USING (
  auth.uid() = id
  OR is_public = true
  OR EXISTS (
    SELECT 1 FROM friendships
    WHERE status = 'accepted'
      AND (
        (requester_id = auth.uid() AND addressee_id = profiles.id)
        OR (requester_id = profiles.id AND addressee_id = auth.uid())
      )
  )
);

CREATE POLICY profiles_update_own ON profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY profiles_delete_own ON profiles FOR DELETE
  USING (auth.uid() = id);

-- Protección is_admin: revocar UPDATE genérico y re-grantear solo columnas seguras.
REVOKE UPDATE ON profiles FROM authenticated;
GRANT UPDATE (username, display_name, bio, avatar_url, voice_type, voice_subtype,
              vocal_range_low, vocal_range_high, instrument_roles, is_public)
  ON profiles TO authenticated;

-- =============================================================
-- 7. RLS — favorites
-- =============================================================
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY favorites_select ON favorites FOR SELECT USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = favorites.user_id
      AND (
        p.is_public = true
        OR EXISTS (
          SELECT 1 FROM friendships
          WHERE status = 'accepted'
            AND (
              (requester_id = auth.uid() AND addressee_id = p.id)
              OR (requester_id = p.id AND addressee_id = auth.uid())
            )
        )
      )
  )
);

CREATE POLICY favorites_insert_own ON favorites FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY favorites_delete_own ON favorites FOR DELETE
  USING (auth.uid() = user_id);

-- =============================================================
-- 8. RLS — friendships
-- =============================================================
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;

CREATE POLICY friendships_select_participant ON friendships FOR SELECT USING (
  auth.uid() = requester_id OR auth.uid() = addressee_id
);

CREATE POLICY friendships_insert_as_requester ON friendships FOR INSERT
  WITH CHECK (auth.uid() = requester_id);

-- Solo el addressee puede mover pending → accepted|blocked.
CREATE POLICY friendships_update_addressee ON friendships FOR UPDATE
  USING (auth.uid() = addressee_id AND status = 'pending')
  WITH CHECK (auth.uid() = addressee_id);

-- Cualquiera de los dos puede borrar (cancel / unfriend / reject).
CREATE POLICY friendships_delete_either ON friendships FOR DELETE USING (
  auth.uid() = requester_id OR auth.uid() = addressee_id
);

-- =============================================================
-- 9. Storage bucket `avatars` (público read, owner write)
-- =============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  2 * 1024 * 1024,
  ARRAY['image/webp', 'image/png', 'image/jpeg']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY avatars_public_read ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

CREATE POLICY avatars_owner_insert ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY avatars_owner_update ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY avatars_owner_delete ON storage.objects FOR DELETE
  USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
