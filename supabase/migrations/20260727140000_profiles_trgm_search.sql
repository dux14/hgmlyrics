-- Búsqueda de perfiles as-you-type con LIKE '%q%' (api/social/search.js) hace
-- seq scan de profiles en cada tecla: los índices btree existentes solo sirven
-- prefijos, no wildcards líderes. pg_trgm + GIN habilita ese patrón con índice.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS profiles_username_trgm_idx
  ON profiles USING gin (lower(username) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS profiles_display_name_trgm_idx
  ON profiles USING gin (lower(display_name) gin_trgm_ops);
