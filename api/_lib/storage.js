import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

const BUCKET = 'covers-uploads';
const AVATARS_BUCKET = 'avatars';

const supabase = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Upload a file (Node ReadableStream or Buffer) to the covers-uploads bucket.
 * Returns the public URL.
 */
export async function uploadCover({ filename, contentType, body }) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const key = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safe}`;

  const { error } = await supabase.storage.from(BUCKET).upload(key, body, {
    contentType: contentType || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
  return data.publicUrl;
}

/**
 * Upload an avatar at avatars/{userId}/avatar.{ext}. Uses service role so we
 * sidestep the storage.objects RLS check that mis-reads asymmetric user JWTs
 * (see GitHub PR #11 notes). Returns the public URL with a cache-busting tag.
 */
export async function uploadAvatar({ userId, ext, contentType, body }) {
  const safeExt = (ext || 'webp').toLowerCase().replace(/[^a-z0-9]/g, '') || 'webp';
  const key = `${userId}/avatar.${safeExt}`;

  const { error } = await supabase.storage.from(AVATARS_BUCKET).upload(key, body, {
    contentType: contentType || 'application/octet-stream',
    upsert: true,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(key);
  return `${data.publicUrl}?t=${Date.now()}`;
}

/**
 * Remove any uploaded avatar variants for a user. Best-effort: ignores
 * "not found" errors so calling DELETE on a user without a custom avatar
 * still succeeds. Returns nothing.
 */
export async function deleteAvatarObjects(userId) {
  const keys = ['webp', 'png', 'jpg'].map((ext) => `${userId}/avatar.${ext}`);
  const { error } = await supabase.storage.from(AVATARS_BUCKET).remove(keys);
  if (error && !/not.*found/i.test(error.message || '')) throw error;
}

// ──────────────────────────────────────────────
// Mapas del mundo — bucket publico 'world-maps'
// ──────────────────────────────────────────────
const WORLD_MAPS_BUCKET = 'world-maps';

/**
 * Sube un tileset al bucket 'world-maps' usando el cliente service-role,
 * igual que uploadAvatar. Retorna la URL publica.
 * Se invoca desde el endpoint admin (api/admin/tileset-upload.js), nunca
 * desde el cliente directamente, para sortear el bloqueo RLS de Storage.
 *
 * @param {{ path: string, contentType: string, body: Buffer|NodeJS.ReadableStream }} opts
 * @returns {Promise<string>} URL publica del tileset subido.
 */
export async function uploadTileset({ path, contentType, body }) {
  const { error } = await supabase.storage
    .from(WORLD_MAPS_BUCKET)
    .upload(path, body, { contentType: contentType || 'image/png', upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from(WORLD_MAPS_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// ──────────────────────────────────────────────
// Estudio de pistas — bucket privado 'stems-jobs'
// ──────────────────────────────────────────────
const STEMS_BUCKET = 'stems-jobs';

/**
 * Signed upload URL para que el browser suba el input directo a Storage.
 * @param {string} key - p.ej. `${userId}/${jobId}/input/cancion.mp3`
 * @returns {Promise<{ path: string, token: string }>}
 */
export async function createStemsUploadUrl(key) {
  const { data, error } = await supabase.storage.from(STEMS_BUCKET).createSignedUploadUrl(key);
  if (error) throw error;
  return { path: data.path, token: data.token };
}

/**
 * Signed PUT URL para que el orquestador de Modal suba un track procesado.
 * A diferencia de createStemsUploadUrl (que devuelve {path, token} para el SDK del browser),
 * este devuelve la signedUrl completa para que un proceso externo la use con HTTP PUT.
 * @param {string} key - p.ej. `${userId}/${jobId}/${section}/${track}.mp3`
 * @returns {Promise<string>} URL firmada (PUT)
 */
export async function createStemsSignedPutUrl(key) {
  const { data, error } = await supabase.storage.from(STEMS_BUCKET).createSignedUploadUrl(key);
  if (error) throw error;
  return data.signedUrl;
}

/**
 * Copia un archivo remoto (output de Replicate) al bucket de stems.
 * @param {string} url - URL temporal de replicate.delivery
 * @param {string} key - destino en el bucket
 */
export async function copyUrlToStems(url, key) {
  const res = await fetch(url);
  if (!res.ok) {
    const e = new Error(`No se pudo descargar el resultado (${res.status})`);
    e.status = 502;
    throw e;
  }
  const body = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') ?? 'audio/wav';
  const { error } = await supabase.storage
    .from(STEMS_BUCKET)
    .upload(key, body, { contentType, upsert: true });
  if (error) throw error;
  return key;
}

/**
 * Signed URL de descarga (6h por defecto).
 * Los resultados se prometen disponibles 48h; 6h reduce la probabilidad de que un audio
 * en pestaña abierta expire antes de que el usuario lo descargue.
 * TODO: re-firmar al reproducir si el TTL no cubre las 48h
 * @param {string} key
 * @param {number} [expiresIn]
 */
export async function signStemsDownload(key, expiresIn = 21600) {
  const { data, error } = await supabase.storage.from(STEMS_BUCKET).createSignedUrl(key, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

/**
 * Borra TODOS los archivos bajo un prefijo (input + resultados de un job).
 * @param {string} prefix - p.ej. `${userId}/${jobId}`
 */
export async function deleteStemsPrefix(prefix) {
  const toDelete = [];
  // El bucket anida input/ stems/ voices/: listar cada nivel conocido.
  for (const sub of ['input', 'stems', 'voices']) {
    const { data, error } = await supabase.storage.from(STEMS_BUCKET).list(`${prefix}/${sub}`);
    if (error || !data) continue;
    for (const f of data) toDelete.push(`${prefix}/${sub}/${f.name}`);
  }
  if (toDelete.length > 0) {
    await supabase.storage.from(STEMS_BUCKET).remove(toDelete);
  }
}
