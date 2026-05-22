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
