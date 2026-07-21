/**
 * pipelineApi.js — Cliente del pipeline unificado por canción (plan C: gate de
 * letra; plan D montará runs). Mismo patrón de auth headers que
 * sectionAudioApi.js. Admin-only en el backend (requireAdmin): a diferencia de
 * fetchSectionAudio, estas funciones SIEMPRE lanzan en error — el panel de
 * revisión debe poder mostrar el fallo al admin.
 */
import { getSession } from './authStore.js';

function authHeaders() {
  const s = getSession();
  return s ? { Authorization: `Bearer ${s.access_token}` } : {};
}

async function readError(res, fallback) {
  const body = await res.json().catch(() => ({}));
  const err = new Error(body.error || fallback);
  err.status = res.status;
  return err;
}

/**
 * Documento de revisión de letra del run en `awaiting_lyrics` de una canción.
 * @param {string} songId
 * @returns {Promise<{review:object, temperature:number, canApprove:boolean, suggestions:Array}>}
 */
export async function getLyricsReview(songId) {
  const res = await fetch(`/api/songs/${songId}/pipeline/lyrics`, { headers: authHeaders() });
  if (!res.ok) throw await readError(res, 'No se pudo cargar la revisión de letra');
  return res.json();
}

/**
 * Aplica una acción de edición sobre el documento (resolver conflicto,
 * partir/unir renglón o sección, aceptar/rechazar vocalización).
 * @param {string} songId
 * @param {object} action
 * @returns {Promise<{review:object, temperature:number, canApprove:boolean}>}
 */
export async function sendLyricsAction(songId, action) {
  const res = await fetch(`/api/songs/${songId}/pipeline/lyrics`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw await readError(res, 'No se pudo aplicar el cambio');
  return res.json();
}

/**
 * Aprueba la letra revisada: publica el snapshot a `songs.sections` y
 * dispara las fases derivadas. 409 si todavía quedan conflictos o
 * vocalizaciones sin decidir.
 * @param {string} songId
 * @returns {Promise<{success:boolean}>}
 */
export async function approveLyrics(songId) {
  const res = await fetch(`/api/songs/${songId}/pipeline/lyrics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
  });
  if (!res.ok) throw await readError(res, 'No se pudo aprobar la letra');
  return res.json();
}
