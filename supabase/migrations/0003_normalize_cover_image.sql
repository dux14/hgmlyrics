-- Normalize 27 `cover_image` rows that store a bare filename (e.g. 'pasion.webp')
-- to the canonical absolute path used by the other 87 rows (e.g. '/covers/pasion.webp').
--
-- The trigger `set_updated_at` fires on UPDATE — these rows will get a fresh
-- `updated_at` and the next `/api/version` will tick `dataVersion` so PWA
-- clients refetch.
--
-- Idempotent: the WHERE clause excludes already-normalized rows.

UPDATE public.songs
SET cover_image = '/covers/' || cover_image
WHERE cover_image IS NOT NULL
  AND cover_image <> ''
  AND cover_image NOT LIKE '/%'
  AND cover_image NOT LIKE 'http%';
