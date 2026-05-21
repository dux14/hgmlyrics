-- Post-migration cleanup based on Supabase advisor findings (2026-05-21).
--
-- 1. Security (WARN, lint 0011): `set_updated_at` had mutable search_path.
--    Pin search_path to `pg_catalog` so `now()` always resolves to the
--    built-in regardless of a caller's session-level search_path.
--
-- 2. Performance (INFO, lint 0005): drop `songs_album_slug_idx` — unused
--    since cutover; queries hit `songs_album_order_idx` instead.

ALTER FUNCTION public.set_updated_at() SET search_path = pg_catalog;

DROP INDEX IF EXISTS public.songs_album_slug_idx;
