/**
 * songAudioApi.js — Cliente del audio completo de la canción + estado de
 * timings de alignment (api/songs/:id/audio). El GET requiere sesión
 * (requireUser en el backend); mismo patrón de auth headers que
 * sectionAudioApi.js.
 */
import { getSession } from './authStore.js';

function authHeaders() {
  const s = getSession();
  return s ? { Authorization: `Bearer ${s.access_token}` } : {};
}

/**
 * Trae el audio completo (mp3 + duración) y el estado de los timings por
 * línea de una canción. Tolerante a cualquier fallo (401/404/500/red caída/
 * JSON inválido) — la vista inmersiva debe degradar a timer sin audio en
 * cualquier caso, así que nunca lanza: null silencioso en todo camino de error.
 * @param {string} songId
 * @returns {Promise<{audio:{url:string,durationSec:number|null}|null, timings:{status:string,lines:Array}|null}|null>}
 */
export async function getSongAudio(songId) {
  try {
    const res = await fetch(`/api/songs/${songId}/audio`, { headers: authHeaders() });
    if (!res.ok) return null;
    const body = await res.json();
    return { audio: body.audio ?? null, timings: body.timings ?? null };
  } catch {
    return null;
  }
}

/**
 * Paso 1: upsert de la fila song_audio + URL firmada de subida a Storage.
 * Admin-only en el backend (requireAdmin) — a diferencia de getSongAudio, SÍ
 * lanza en error: el editor debe poder mostrar el fallo al admin.
 * @param {string} songId
 * @returns {Promise<{uploadUrl:string, key:string}>}
 */
export async function createSongAudioUpload(songId) {
  const res = await fetch(`/api/songs/${songId}/audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({}),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'No se pudo iniciar la subida');
  return body;
}

/**
 * Paso 2: confirma la duración (subida directa a Storage ya ocurrida) y
 * dispara el alignment automático. Admin-only.
 * @param {string} songId
 * @param {number} durationSec
 */
export async function confirmSongAudio(songId, durationSec) {
  const res = await fetch(`/api/songs/${songId}/audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ confirm: true, durationSec }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'No se pudo confirmar el audio');
}

/**
 * Elimina el mp3 completo (fila + objeto en storage + timings). Admin-only.
 * @param {string} songId
 */
export async function deleteSongAudio(songId) {
  const res = await fetch(`/api/songs/${songId}/audio`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'No se pudo eliminar el audio');
}

/**
 * Sube el archivo directo a la signed URL devuelta por createSongAudioUpload
 * (sin auth propia — la firma de Storage ya autoriza la subida).
 * @param {string} uploadUrl
 * @param {File} file
 */
export async function uploadSongAudioFile(uploadUrl, file) {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'audio/mpeg' },
    body: file,
  });
  if (!res.ok) throw new Error('No se pudo subir el archivo de audio');
}
