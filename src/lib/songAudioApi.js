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
