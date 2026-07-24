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
 * @returns {Promise<{review:object, canApprove:boolean, suggestions:Array}>}
 */
export async function getLyricsReview(songId) {
  const res = await fetch(`/api/songs/${songId}/pipeline/lyrics`, { headers: authHeaders() });
  if (!res.ok) throw await readError(res, 'No se pudo cargar la revisión de letra');
  return res.json();
}

/**
 * Aplica una acción de edición sobre el documento (editar renglón,
 * partir/unir renglón o sección, mover o borrar renglón, alternar
 * vocalización, renombrar o retipar sección).
 * @param {string} songId
 * @param {object} action
 * @returns {Promise<{review:object, canApprove:boolean}>}
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
 * Aprueba la letra revisada: escribe el snapshot al store propio del
 * pipeline (`song_pipeline_lyrics`, sin tocar `songs.sections`) y dispara
 * las fases derivadas. 409 si el documento no tiene renglones aprobables
 * (`canApprove` false).
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
 * Reabre una letra ya aprobada (`lyrics_review` done, run running/done) para
 * volver a editarla: invalida en cascada sync/pitch/clips y devuelve el run
 * a `awaiting_lyrics`. 409 si el run no está en un estado que lo permita.
 * @param {string} songId
 * @returns {Promise<{success:boolean}>}
 */
export async function reopenLyrics(songId) {
  const res = await fetch(`/api/songs/${songId}/pipeline/lyrics`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ action: { type: 'reopen' } }),
  });
  if (!res.ok) throw await readError(res, 'No se pudo reabrir la letra');
  return res.json();
}

/**
 * Publica la letra del pipeline al cancionero (solo texto, one-way, admin).
 * Copia `song_pipeline_lyrics` a `songs.sections` sin correr alignment: el
 * karaoke ya consume el store del pipeline directamente. 404 si la canción
 * no tiene letra de pipeline aprobada.
 * @param {string} songId
 * @returns {Promise<{success:boolean}>}
 */
export async function publishLyricsToSongbook(songId) {
  const res = await fetch(`/api/songs/${songId}/pipeline/lyrics`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ action: { type: 'publishToSongbook' } }),
  });
  if (!res.ok) throw await readError(res, 'No se pudo publicar la letra al cancionero');
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
 * @returns {Promise<{runId:string, uploadUrl:string, titleScore:number, threshold:number, songTitle:string}>}
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
 * @returns {Promise<{success:boolean, titleScore:number, threshold:number, songTitle:string}>}
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
 * Edita el label y/o los bordes (startMs/endMs) de UN segmento de la
 * estructura detectada (SongFormer, `song_structure.segments`). Admin-only
 * en el backend; el backend valida label contra las 8 clases de SongFormer y
 * que los bordes no se solapen con los segmentos vecinos (400 si no).
 * @param {string} songId
 * @param {{segmentIndex:number, label?:string, startMs?:number, endMs?:number}} patch
 * @returns {Promise<{segments:Array}>}
 */
export async function patchStructure(songId, patch) {
  const res = await fetch(`/api/songs/${songId}/structure`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await readError(res, 'No se pudo actualizar la sección');
  return res.json();
}

/**
 * Suscribe el estado del run de una canción. El Realtime Broadcast (canal
 * 'pipeline:run:{songId}', evento 'change' que emite el trigger
 * song_pipeline_runs_broadcast_status) es solo la señal "algo cambió": el dato
 * real lo trae getPipelineRun. Un polling de 3s actúa de fallback si el
 * Realtime no conecta. onChange recibe la respuesta del GET ({run} | null).
 * @param {string} songId
 * @param {(data:{run:object}|{error:Error}|null)=>void} onChange
 * @returns {(()=>void)&{refresh:()=>Promise<void>}} unsubscribe idempotente,
 *   invocable como función; `.refresh` fuerza un refresh fuera de ciclo (p.
 *   ej. desde un botón "Reintentar" tras un {error}).
 */
// Estados terminales del run: no cambian sin acción del usuario, así que el
// polling de 3s se detiene al alcanzarlos (evita martillar /pipeline —> getUser
// —> 429 de Supabase Auth cuando una pestaña queda abierta sobre una canción ya
// procesada). Un broadcast reactiva el polling si arranca un run nuevo.
const TERMINAL_RUN_STATUSES = new Set(['done', 'failed', 'cancelled', 'superseded']);
// Coalesce de la ráfaga de broadcasts (el trigger emite un 'change' por cada
// transición de fase durante el procesamiento): un trailing debounce agrupa la
// ráfaga en un solo refresh en vez de un GET inmediato por evento.
const BROADCAST_DEBOUNCE_MS = 400;

export function watchPipelineRun(songId, onChange) {
  let stopped = false;
  // Contador monotónico: polling y broadcast pueden solaparse y resolver fuera
  // de orden. Solo la petición más reciente emite, para no regresar la vista a
  // un estado viejo.
  let lastReqId = 0;
  let pollId = null;
  let debounceId = null;

  function startPolling() {
    if (pollId || stopped) return;
    pollId = setInterval(refresh, 3000);
  }
  function stopPolling() {
    if (pollId) {
      clearInterval(pollId);
      pollId = null;
    }
  }

  async function refresh() {
    // El botón "Reintentar" del banner de error llama a `.refresh()` incluso
    // después de un unsubscribe (p. ej. click justo cuando se desmonta la
    // vista): cortamos ANTES del fetch de red para no disparar una petición
    // que de todos modos se va a descartar.
    if (stopped) return;
    const reqId = (lastReqId += 1);
    let data;
    try {
      data = await getPipelineRun(songId);
    } catch (err) {
      // No cortamos el watch: el próximo tick de polling reintenta. Se loguea
      // para que un fallo permanente (sesión muerta, admin revocado, 500
      // persistente) no deje la vista muda sin señal alguna. Además emitimos
      // un sentinel {error} para que el consumer pinte un estado de error en
      // vez de quedar en blanco (el catch previo tragaba el error entero).
      console.error('watchPipelineRun: no se pudo refrescar el run', err);
      if (stopped || reqId !== lastReqId) return;
      onChange({ error: err });
      return;
    }
    // Descarta respuestas obsoletas o posteriores al unsubscribe. onChange
    // queda FUERA del try: un error del consumer no debe enmascararse como
    // ruido de red.
    if (stopped || reqId !== lastReqId) return;
    // Corta el polling en estado terminal; lo mantiene/reactiva mientras el run
    // esté activo (o no exista todavía: null —> el usuario aún puede subir audio).
    const status = data?.run?.status ?? null;
    if (status && TERMINAL_RUN_STATUSES.has(status)) {
      stopPolling();
    } else {
      startPolling();
    }
    onChange(data);
  }

  const channel = supabase.channel(`pipeline:run:${songId}`, {
    config: { broadcast: { self: false } },
  });
  channel.on('broadcast', { event: 'change' }, () => {
    if (stopped) return;
    if (debounceId) clearTimeout(debounceId);
    debounceId = setTimeout(() => {
      debounceId = null;
      // Un broadcast implica que algo cambió (p. ej. arrancó un run nuevo tras
      // uno terminal): reactiva el polling y refresca.
      startPolling();
      refresh();
    }, BROADCAST_DEBOUNCE_MS);
  });
  channel.subscribe();

  startPolling();
  refresh();

  function unsubscribe() {
    if (stopped) return;
    stopped = true;
    stopPolling();
    if (debounceId) clearTimeout(debounceId);
    supabase.removeChannel(channel);
  }
  // Se mantiene el contrato de "función invocable" (único call-site sigue
  // haciendo unsub()); refresh queda colgado como propiedad para que un
  // botón "Reintentar" pueda forzar el próximo refresh sin duplicar la
  // suscripción entera.
  unsubscribe.refresh = refresh;
  return unsubscribe;
}
