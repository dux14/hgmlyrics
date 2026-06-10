-- world_avatars.sql — Avatar del mundo virtual por usuario (M4.1).
--
-- Esquema ALINEADO con src/lib/worldAvatarStore.js (M4.4, ya en main):
--   PK `uid`, `config` jsonb, `updated_at`. La URL del spritesheet se deriva por
--   convención del bucket `avatars` (ruta plana `{uid}.png`), por eso NO se
--   persiste una columna `spritesheet_url` (difiere del spec §5.1, que la incluía:
--   el store nunca la escribe, un NOT NULL rompería sus upserts).
--
-- Storage: se REUSA el bucket `avatars` existente (avatares de perfil, creado en
--   20260522031737_auth_profile_social.sql). El read público ya está cubierto por
--   la policy `avatars_public_read`. Las policies de perfil exigen propiedad por
--   carpeta `{uid}/...`; el mundo escribe en la raíz `{uid}.png`, así que se añaden
--   dos policies planas de propietario (insert/update) que conviven sin colisión
--   de keys con las de perfil.

CREATE TABLE public.world_avatars (
  uid        uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  config     jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Reusa la función endurecida set_updated_at() (search_path fijado en 0002).
CREATE TRIGGER world_avatars_set_updated_at
  BEFORE UPDATE ON public.world_avatars
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.world_avatars ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier usuario autenticado (para renderizar a los peers).
CREATE POLICY world_avatars_read ON public.world_avatars
  FOR SELECT TO authenticated
  USING (true);

-- Inserción: solo el dueño de la fila.
CREATE POLICY world_avatars_insert ON public.world_avatars
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = uid);

-- Actualización: solo el dueño de la fila.
CREATE POLICY world_avatars_update ON public.world_avatars
  FOR UPDATE TO authenticated
  USING (auth.uid() = uid)
  WITH CHECK (auth.uid() = uid);

-- ---------------------------------------------------------------------------
-- Storage: escritura del propietario sobre la ruta plana `avatars/{uid}.png`.
-- (El read público lo cubre la policy avatars_public_read existente.)
-- ---------------------------------------------------------------------------

CREATE POLICY world_avatars_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND name = auth.uid()::text || '.png');

CREATE POLICY world_avatars_owner_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND name = auth.uid()::text || '.png')
  WITH CHECK (bucket_id = 'avatars' AND name = auth.uid()::text || '.png');
