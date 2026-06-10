/**
 * worldAvatarStore.js — persistencia de avatares del mundo virtual.
 *
 * Asume que existen:
 *   - Bucket Storage `avatars` (acceso público).
 *   - Tabla `world_avatars` (uid PK, config jsonb, updated_at).
 */

/**
 * Guarda el avatar de un usuario: sube el PNG a Storage y hace upsert en tabla.
 *
 * @param {{ supabase: object, user: { id: string }, config: object, blob: Blob }} opts
 * @returns {Promise<{ uid: string }>}
 */
export async function saveAvatar({ supabase, user, config, blob }) {
  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(`${user.id}.png`, blob, { upsert: true, contentType: 'image/png' });

  if (uploadError) throw uploadError;

  const { error: upsertError } = await supabase
    .from('world_avatars')
    .upsert({ uid: user.id, config });

  if (upsertError) throw upsertError;

  return { uid: user.id };
}

/**
 * Carga el avatar de un usuario por uid.
 *
 * @param {{ supabase: object, uid: string }} opts
 * @returns {Promise<{ config: object, url: string } | null>}
 *   null cuando no existe fila para ese uid.
 */
export async function loadAvatar({ supabase, uid }) {
  const { data, error } = await supabase
    .from('world_avatars')
    .select('config')
    .eq('uid', uid)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const url = supabase.storage.from('avatars').getPublicUrl(`${uid}.png`)?.data?.publicUrl ?? '';

  return { config: data.config, url };
}
