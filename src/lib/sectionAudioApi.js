/**
 * sectionAudioApi.js — Cliente del audio por sección (api/songs/:id/section-audio).
 * El GET requiere sesión (requireUser en el backend); mismo patrón de auth
 * headers que pitchApi.js/stemsApi.js.
 */
import { getSession } from './authStore.js';

function authHeaders() {
  const s = getSession();
  return s ? { Authorization: `Bearer ${s.access_token}` } : {};
}

/**
 * Trae las pistas de audio por sección de una canción. Tolerante a cualquier
 * fallo (401/404/500/red caída) — la vista de canción debe funcionar igual
 * sin audio, así que nunca lanza: siempre resuelve, [] si no hay nada.
 * @param {string} songId
 * @returns {Promise<Array<{id:string, sectionIndex:number, voiceScope:string|null, label:string|null, durationSec:number|null, url:string}>>}
 */
export async function fetchSectionAudio(songId) {
  try {
    const res = await fetch(`/api/songs/${songId}/section-audio`, { headers: authHeaders() });
    if (!res.ok) return [];
    const body = await res.json().catch(() => ({}));
    return Array.isArray(body.items) ? body.items : [];
  } catch {
    return [];
  }
}

/**
 * Crea (o reemplaza, upsert por sección+voiceScope) el registro de audio de una
 * sección y devuelve la signed URL de subida. Admin-only en el backend
 * (requireAdmin) — a diferencia de fetchSectionAudio, SÍ lanza en error: el
 * editor debe poder mostrar el fallo al admin.
 * @param {string} songId
 * @param {{sectionIndex:number, voiceScope?:string|null, label?:string|null, durationSec?:number|null}} meta
 * @returns {Promise<{uploadUrl:string, key:string, id:string}>}
 */
export async function createSectionAudio(songId, meta) {
  const res = await fetch(`/api/songs/${songId}/section-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(meta),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'No se pudo crear el audio de la sección');
  return body;
}

/**
 * Sube el archivo directo a la signed URL devuelta por createSectionAudio.
 * @param {string} uploadUrl
 * @param {File} file
 */
export async function uploadSectionAudioFile(uploadUrl, file) {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'audio/mpeg' },
    body: file,
  });
  if (!res.ok) throw new Error('La subida del audio falló. Revisa tu conexión e intenta de nuevo.');
}

/**
 * Elimina un audio de sección (fila + objeto en storage). Admin-only.
 * @param {string} songId
 * @param {string} id
 */
export async function deleteSectionAudio(songId, id) {
  const res = await fetch(`/api/songs/${songId}/section-audio`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ id }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'No se pudo eliminar el audio');
}
