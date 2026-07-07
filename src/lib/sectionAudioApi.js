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
