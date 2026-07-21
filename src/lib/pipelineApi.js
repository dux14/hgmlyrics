/**
 * pipelineApi.js — Cliente del pipeline unificado por canción (plan C: gate de
 * letra; plan D montará runs). Mismo patrón de auth headers que
 * sectionAudioApi.js. Admin-only en el backend (requireAdmin): a diferencia de
 * fetchSectionAudio, estas funciones SIEMPRE lanzan en error — el panel de
 * revisión debe poder mostrar el fallo al admin.
 */
import { getSession } from './authStore.js';
import { supabase } from './supabase.js';

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

/**
 * Estado del run activo del pipeline de una canción.
 * @param {string} songId
 * @returns {Promise<{run:object}|null>} null si no hay run activo (404).
 */
export async function getPipelineRun(songId) {
  const res = await fetch(`/api/songs/${songId}/pipeline`, { headers: authHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw await readError(res, 'No se pudo cargar el estado del procesamiento');
  return res.json();
}

/**
 * Crea un run nuevo y devuelve la URL de subida firmada del mp3. El override
 * del título es implícito: crear el run YA es el override (el backend solo
 * persiste el titleScore para la advertencia). El displayName no viaja en el
 * POST; se aplica después con renamePipelineAudio si el admin puso nombre propio.
 * @param {string} songId
 * @param {{fileName:string, size?:number, mime?:string}} opts
 * @returns {Promise<{runId:string, uploadUrl:string, titleScore:number, threshold:number}>}
 */
export async function createPipelineRun(songId, { fileName, size = null, mime = null } = {}) {
  const res = await fetch(`/api/songs/${songId}/pipeline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ filename: fileName, size, mime }),
  });
  if (!res.ok) throw await readError(res, 'No se pudo crear el procesamiento');
  return res.json();
}

/**
 * Confirma la subida del mp3 completo y arranca el procesamiento. `durationSec`
 * (leída en el browser antes de subir) viaja para que el backend registre la
 * duración del audio.
 * @param {string} songId
 * @param {{durationSec?:number}} [opts]
 * @returns {Promise<{success:boolean}>}
 */
export async function confirmPipelineUpload(songId, { durationSec } = {}) {
  const res = await fetch(`/api/songs/${songId}/pipeline/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ durationSec }),
  });
  if (!res.ok) throw await readError(res, 'No se pudo confirmar la subida');
  return res.json();
}

/**
 * Reintenta una fase failed/stale del run activo.
 * @param {string} songId
 * @param {string} phase
 * @returns {Promise<object>}
 */
export async function retryPipelinePhase(songId, phase) {
  const res = await fetch(`/api/songs/${songId}/pipeline/retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ phase }),
  });
  if (!res.ok) throw await readError(res, 'No se pudo reintentar la fase');
  return res.json();
}

/**
 * Cancela el run activo de la canción.
 * @param {string} songId
 * @returns {Promise<{success:boolean}>}
 */
export async function cancelPipelineRun(songId) {
  const res = await fetch(`/api/songs/${songId}/pipeline`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw await readError(res, 'No se pudo cancelar el procesamiento');
  return res.json();
}

/**
 * Edita el nombre mostrado del audio del run activo (input_meta.displayName).
 * @param {string} songId
 * @param {string} displayName
 * @returns {Promise<{success:boolean}>}
 */
export async function renamePipelineAudio(songId, displayName) {
  const res = await fetch(`/api/songs/${songId}/pipeline`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ displayName }),
  });
  if (!res.ok) throw await readError(res, 'No se pudo renombrar el audio');
  return res.json();
}

/**
 * Suscribe el estado del run de una canción. El Realtime Broadcast (canal
 * 'pipeline:run:{songId}', evento 'change' que emite el trigger
 * song_pipeline_runs_broadcast_status) es solo la señal "algo cambió": el dato
 * real lo trae getPipelineRun. Un polling de 3s actúa de fallback si el
 * Realtime no conecta. onChange recibe la respuesta del GET ({run} | null).
 * @param {string} songId
 * @param {(data:{run:object}|null)=>void} onChange
 * @returns {()=>void} unsubscribe idempotente.
 */
export function watchPipelineRun(songId, onChange) {
  let stopped = false;
  // Contador monotónico: polling y broadcast pueden solaparse y resolver fuera
  // de orden. Solo la petición más reciente emite, para no regresar la vista a
  // un estado viejo.
  let lastReqId = 0;

  async function refresh() {
    const reqId = (lastReqId += 1);
    let data;
    try {
      data = await getPipelineRun(songId);
    } catch (err) {
      // No cortamos el watch: el próximo tick de polling reintenta. Se loguea
      // para que un fallo permanente (sesión muerta, admin revocado, 500
      // persistente) no deje la vista muda sin señal alguna.
      console.error('watchPipelineRun: no se pudo refrescar el run', err);
      return;
    }
    // Descarta respuestas obsoletas o posteriores al unsubscribe. onChange
    // queda FUERA del try: un error del consumer no debe enmascararse como
    // ruido de red.
    if (stopped || reqId !== lastReqId) return;
    onChange(data);
  }

  const channel = supabase.channel(`pipeline:run:${songId}`, {
    config: { broadcast: { self: false } },
  });
  channel.on('broadcast', { event: 'change' }, () => {
    refresh();
  });
  channel.subscribe();

  const pollId = setInterval(refresh, 3000);
  refresh();

  return function unsubscribe() {
    if (stopped) return;
    stopped = true;
    clearInterval(pollId);
    supabase.removeChannel(channel);
  };
}
