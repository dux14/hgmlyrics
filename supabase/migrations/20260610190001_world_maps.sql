-- world_maps.sql — Tabla de mapas del mundo virtual + bucket world-maps (Fase 3 editor admin).
--
-- Diseño de escrituras (gating de admin):
--   El gating de admin en este proyecto vive en la capa Vercel Function
--   (api/_lib/auth.js → requireAdmin, usando ADMIN_EMAILS + profiles.is_admin).
--   El endpoint de admin usa el cliente service-role, que OMITE RLS completamente.
--   Por tanto: NO se crean policies INSERT/UPDATE/DELETE para `authenticated`; solo
--   SELECT. Cualquier escritura que llegue sin el cliente service-role será bloqueada
--   por omisión (RLS deniega lo que no está explícitamente permitido).
--
-- Storage bucket `world-maps`:
--   Lectura pública para que los clientes carguen el tileset sin token.
--   Escritura restringida al service-role (sin policies de escritura para `authenticated`),
--   igual que la lógica de escritura de la tabla.

-- =============================================================
-- 1. Tabla world_maps
-- =============================================================
CREATE TABLE public.world_maps (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text        NOT NULL,
  tiled_json   jsonb       NOT NULL,
  tileset_url  text        NOT NULL,
  is_active    boolean     NOT NULL DEFAULT false,
  updated_by   uuid        REFERENCES auth.users(id),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Solo puede existir UN mapa activo a la vez.
CREATE UNIQUE INDEX world_maps_one_active ON public.world_maps (is_active) WHERE is_active;

-- =============================================================
-- 2. RLS — world_maps
-- =============================================================
ALTER TABLE public.world_maps ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier usuario autenticado (el cliente del mundo carga el mapa activo).
CREATE POLICY world_maps_read ON public.world_maps
  FOR SELECT TO authenticated
  USING (true);

-- Escritura: NO se crean policies para `authenticated`.
--   El cliente service-role (Vercel Function admin) omite RLS y puede escribir libremente.
--   Clientes autenticados normales quedan bloqueados por omisión.

-- =============================================================
-- 3. Storage bucket `world-maps`
-- =============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'world-maps',
  'world-maps',
  true,
  20 * 1024 * 1024,
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Lectura pública: los tilesets son recursos estáticos que cualquier cliente debe cargar.
CREATE POLICY world_maps_bucket_public_read ON storage.objects
  FOR SELECT
  USING (bucket_id = 'world-maps');

-- Escritura: NO se crean policies para `authenticated`.
--   El cliente service-role del endpoint admin bypasea RLS y puede subir/actualizar tilesets.
--   Usuarios autenticados normales quedan bloqueados por omisión.
