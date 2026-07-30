// Forced alignment (WhisperX en Modal) — disparado al confirmar la subida del
// mp3 completo de una cancion.
// Espeja el patron de api/stems/jobs/[id]/start.js: marca processing ANTES de
// postear a Modal y, si el POST falla, marca failed y relanza.
import sql from './db.js';
import { signSongAudioDownload } from './storage.js';
import { fetchWithTimeout, MODAL_DISPATCH_TIMEOUT_MS } from './http.js';
import { getPipelineLyrics } from './pipeline/lyricsStore.js';

/**
 * Proyecta las lineas canonicas de una cancion (modo letra sin voz): salta
 * `annotation`, conserva `spoken`. Replica EXACTAMENTE la regla de
 * `projectLines` en src/lib/projectLines.js (el front); la paridad de ambas
 * se verifica con la misma fixture en tests/projectLines.test.js.
 * @param {Array<{lines?: Array<{annotation?:boolean, text?:string}>}>} sections
 * @returns {Array<{i:number, text:string}>}
 */
export function projectCanonicalLines(sections) {
  const lines = [];
  for (const section of sections || []) {
    for (const line of section.lines || []) {
      if (line.annotation) continue;
      lines.push({ i: lines.length, text: line.text || '' });
    }
  }
  return lines;
}

/**
 * Mapeo línea canónica → sección, en el mismo orden/regla que
 * `projectCanonicalLines` (misma iteración: secciones en orden de documento,
 * `lines:null` no aporta líneas, se saltan las `annotation`). El resultado es
 * un array paralelo: `result[i]` = índice de la sección (en `sections`, el
 * mismo espacio de índices que usa `_dispatch.js` para las signed PUT URLs de
 * clips por sección) a la que pertenece la línea canónica `i`.
 * @param {Array} sections
 * @returns {number[]}
 */
export function projectLineSections(sections) {
  const result = [];
  (sections || []).forEach((section, sectionIndex) => {
    for (const line of section.lines || []) {
      if (line.annotation) continue;
      result.push(sectionIndex);
    }
  });
  return result;
}

/**
 * Dispara (o re-dispara) el forced alignment en Modal para `songId`.
 * Idempotente: si song_line_timings ya esta en 'processing', no hace nada.
 * @param {string} songId
 * @param {string} [snapshotHash] Hash de la letra aprobada (fase `sync` del
 *   pipeline unificado, plan C). Opcional: karaoke standalone llama sin este
 *   parametro y el payload viaja igual que antes (snapshotHash ausente/null).
 * @param {{alreadyClaimedByCaller?: boolean}} [options] `alreadyClaimedByCaller`:
 *   el llamador ya se garantizó la exclusión por otra vía (p. ej. un claim
 *   transaccional `FOR UPDATE` sobre el run) y por eso escribió
 *   `song_line_timings.status = 'processing'` ANTES de llamar a esta función.
 *   Sin esta opción, ese mismo llamador se autobloquearía: la guarda de abajo
 *   leería el 'processing' que él mismo acaba de escribir y rechazaría con
 *   409 (caso real: `realign.js`). Solo `realign.js` debe pasar `true` — el
 *   resto de los llamadores (`confirm.js`, `retry.js`, `_dispatch.js`,
 *   `audio.js`) no tienen ese claim previo y necesitan la guarda intacta.
 * @throws {Error & {status:number}} 409 'Sin audio' si no hay song_audio.
 */
export async function dispatchAlign(songId, snapshotHash, options = {}) {
  const { alreadyClaimedByCaller = false } = options;
  // Lecturas independientes por songId: en paralelo (menos latencia antes del
  // POST a Modal, que ya es lento de por si).
  const [[audio], [timings]] = await Promise.all([
    sql`
      SELECT storage_key AS "storageKey" FROM song_audio WHERE song_id = ${songId}
    `,
    sql`
      SELECT status, updated_at AS "updatedAt" FROM song_line_timings WHERE song_id = ${songId}
    `,
  ]);
  if (!audio) {
    const e = new Error('Sin audio');
    e.status = 409;
    throw e;
  }
  // Fix MEDIUM (auditoría 27-jul): antes este `return` era un no-op
  // silencioso -- el caller (confirm.js/retry.js/_dispatch.js) lo trataba
  // como éxito (id undefined) y ningún admin se enteraba de que el dispatch
  // no hizo nada. Un 409 explícito hace visible el conflicto, igual criterio
  // que el resto del pipeline (confirm.js/retry.js ya usan 409 para carreras).
  // Un dispatch que falla no significa que el job no arrancó, pero tampoco
  // puede bloquear para siempre: si nadie escribió la fila en 30 minutos,
  // está muerta (el cuelgue heredado de un webhook perdido).
  const stale =
    timings?.updatedAt && Date.now() - new Date(timings.updatedAt).getTime() > 30 * 60 * 1000;
  if (timings?.status === 'processing' && !stale && !alreadyClaimedByCaller) {
    const e = new Error('El alineamiento ya está en curso para esta canción');
    e.status = 409;
    throw e;
  }

  // Lecturas independientes: signing y las dos fuentes posibles de letra en
  // paralelo (mismo criterio que arriba).
  const [audioUrl, [song], pipelineLyrics] = await Promise.all([
    signSongAudioDownload(audio.storageKey),
    sql`SELECT sections FROM songs WHERE id = ${songId}`,
    getPipelineLyrics(sql, songId),
  ]);
  // Fix HIGH 6 (auditoría 27-jul): para una canción de pipeline, songs.sections
  // queda vacío A PROPÓSITO desde F3 (el approve del pipeline ya no la
  // escribe) -- usar solo songs.sections mandaba `lines: []` a Modal, que
  // rechaza con 400 y deja song_line_timings en 'failed', matando el
  // reemplazo manual de audio (api/songs/[id]/audio.js) para cualquier
  // canción que vino del pipeline. Igual criterio que sectionSource en
  // _dispatch.js: el store propio (song_pipeline_lyrics) manda cuando existe.
  const sectionSource = pipelineLyrics?.sections ?? song?.sections;
  const lines = projectCanonicalLines(sectionSource);

  await sql`
    INSERT INTO song_line_timings (song_id, status, error)
    VALUES (${songId}, 'processing', NULL)
    ON CONFLICT (song_id)
    DO UPDATE SET status = 'processing', error = NULL
  `;

  try {
    const endpoint = process.env.MODAL_ALIGN_ENDPOINT;
    const secret = process.env.MODAL_INBOUND_SECRET;
    if (!endpoint || !secret) {
      const e = new Error('MODAL_ALIGN_ENDPOINT / MODAL_INBOUND_SECRET no configurados');
      e.status = 500;
      throw e;
    }

    const base =
      process.env.PUBLIC_BASE_URL ?? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
    const webhookUrl = `${base}/api/align/webhook`;

    const res = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-inbound-secret': secret },
        body: JSON.stringify({ songId, audioUrl, lines, webhookUrl, snapshotHash }),
      },
      { timeoutMs: MODAL_DISPATCH_TIMEOUT_MS, label: 'Modal align' },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const e = new Error(`Modal ${res.status}: ${detail.slice(0, 200)}`);
      e.status = 502;
      throw e;
    }
  } catch (err) {
    await sql`
      UPDATE song_line_timings
      SET status = 'failed', error = ${String(err?.message ?? err).slice(0, 300)}
      WHERE song_id = ${songId}
    `;
    throw err;
  }
}
