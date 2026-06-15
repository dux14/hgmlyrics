-- SEC-06: Restringir SELECT en song_voice_links y song_platform_links a rol authenticated.
--
-- Situación original: las policies de SELECT usaban USING (true) sin TO clause,
-- lo que las hacía aplicables también al rol anon. Cualquier petición con la
-- ANON_KEY podía hacer dump de todos los links de Drive/plataforma sin login.
-- Inconsistente con la tabla songs, que exige auth.uid() IS NOT NULL.
--
-- Investigación realizada (2026-06-15):
-- • src/ no accede a estas tablas directamente (grep limpio).
-- • api/songs/[id]/links.js usa DATABASE_URL (postgres.js → transaction pooler),
--   que se ejecuta como el owner de la BD y omite RLS. El GET de links tampoco
--   llama a requireAdmin, pero sí pasa por el backend autenticado (Vercel Function).
-- • Conclusión: restringir a authenticated es seguro. Si en el futuro se quisiera
--   que los platform_links (YouTube/Spotify) fueran públicos, se podría recrear
--   solo esa policy con USING (true) — por defecto ambas quedan restringidas para
--   ser consistentes con el resto del esquema.

DROP POLICY IF EXISTS song_platform_links_public_read ON song_platform_links;
DROP POLICY IF EXISTS song_voice_links_public_read ON song_voice_links;

CREATE POLICY song_platform_links_auth_read ON song_platform_links
  FOR SELECT TO authenticated USING (true);

CREATE POLICY song_voice_links_auth_read ON song_voice_links
  FOR SELECT TO authenticated USING (true);
