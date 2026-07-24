/**
 * studioApi.js — Cliente de lectura pública del Estudio de una canción
 * (Task D4a): stems firmados, análisis de partitura vocal, secciones y
 * estado del alignment. Mismo patrón de auth headers que pipelineApi.js.
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
 * Estudio publicado de una canción (stems, análisis, secciones, timings,
 * audio manual y clips por sección).
 * @param {string} songId
 * @returns {Promise<{
 *   stems: Array,
 *   analysis: object|null,
 *   sections: Array,
 *   timings: {status:string, lines:Array, beats:Array|null, bpmDetected:number|null}|null,
 *   title: string|null,
 *   structure: {segments:Array}|null,
 *   audio: {bpmManual:number|null, timeSignature:string|null, beatAnchor:number|null}|null,
 *   clips: Array<{sectionIndex:number, voiceScope:string|null, label:string|null, durationSec:number|null, url:string}>,
 * }|null>}
 *   null si la canción todavía no tiene estudio publicado (404).
 */
export async function getSongStudio(songId) {
  const res = await fetch(`/api/songs/${songId}/studio`, { headers: authHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw await readError(res, 'No se pudo cargar el estudio de la canción');
  return res.json();
}
