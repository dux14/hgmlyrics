import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

const BUCKET = 'pitch-jobs';
const supabase = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Signed upload URL (SDK del browser): { path, token }. */
export async function createPitchUploadUrl(key) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(key);
  if (error) throw error;
  return { path: data.path, token: data.token };
}
/**
 * Signed PUT URL completa (para Modal).
 * `upsert: true` porque los artefactos del pipeline son salidas deterministas
 * del job: un re-run o `retry` reusa el mismo jobId (mismo prefijo de storage),
 * así que el nodo debe poder SOBRESCRIBIR su artefacto previo. Sin upsert el
 * endpoint de firma devuelve 400 "The resource already exists" si la key ya
 * existe (rompía separation y cascadeaba el job a failed). Scope de escritura
 * ya acotado al prefijo `${user_id}/${jobId}/` que resuelve sign-upload.js.
 */
export async function createPitchSignedPutUrl(key) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(key, { upsert: true });
  if (error) throw error;
  return data.signedUrl;
}
/** Signed download (6h). */
export async function signPitchDownload(key, expiresIn = 21600) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(key, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}
/** Borra todo el prefijo del job. */
export async function deletePitchPrefix(prefix) {
  const subs = ['input', 'stems', 'f0', 'notes', 'lyrics', 'render', 'export'];
  const toDelete = [];
  const results = await Promise.all(
    subs.map((s) => supabase.storage.from(BUCKET).list(`${prefix}/${s}`)),
  );
  results.forEach(({ data, error }, i) => {
    if (error || !data) return;
    for (const f of data) toDelete.push(`${prefix}/${subs[i]}/${f.name}`);
  });
  if (toDelete.length) await supabase.storage.from(BUCKET).remove(toDelete);
}
