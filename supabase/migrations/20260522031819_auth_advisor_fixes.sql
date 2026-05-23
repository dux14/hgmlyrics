-- 0006: address security advisors from 0005.
-- (1) avatars bucket is public — direct URLs already work; drop SELECT policy so storage.objects can't be listed via RLS API.
DROP POLICY IF EXISTS avatars_public_read ON storage.objects;

-- (2) handle_new_user is a trigger function; it should not be callable via REST.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
