/**
 * pitchNotesApi.js — Cliente de lectura de las sílabas con nota de una canción
 * (song_pitch_analysis), para la acción «traer el tono de la IA» del editor del
 * cancionero. Mismo patrón de auth headers que studioApi.js.
 *
 * Existe aparte de studioApi.js porque /api/songs/[id]/studio responde 404 sin
 * stems publicados y firma stems más clips en batch en la misma llamada:
 * inservible para el editor, que solo necesita las notas por sílaba.
 */
import { getSession } from './authStore.js';

function authHeaders() {
  const s = getSession();
  return s ? { Authorization: `Bearer ${s.access_token}` } : {};
}

/**
 * Sílabas con nota por renglón, agrupadas por voz del análisis.
 * @param {string} songId
 * @returns {Promise<{
 *   hasAnalysis: boolean,
 *   voicesPresent: string[],
 *   voices: Record<string, {lines: Array<{i:number, syllables: Array<{text:string, start:number|null, end:number|null, midi:number|null, note:string|null, cents:number|null}>}>}>,
 * }>}
 */
export async function getSongPitchNotes(songId) {
  const res = await fetch(`/api/songs/${songId}/pitch-notes`, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || 'No se pudo cargar el tono de la canción');
    err.status = res.status;
    throw err;
  }
  return res.json();
}
