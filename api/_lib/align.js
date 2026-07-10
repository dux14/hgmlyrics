// Forced alignment (WhisperX en Modal) — disparado al confirmar la subida del
// mp3 completo de una cancion (y por realineado manual admin, api/songs/[id]/align.js).
// Espeja el patron de api/stems/jobs/[id]/start.js: marca processing ANTES de
// postear a Modal y, si el POST falla, marca failed y relanza.
import sql from './db.js';
import { signSongAudioDownload } from './storage.js';
import { fetchWithTimeout } from './http.js';

/**
 * Proyecta las lineas canonicas de una cancion (modo letra sin voz): salta
 * `annotation`, conserva `spoken`. Replica EXACTAMENTE la regla de
 * `projectLines` en src/components/StageMode.js (linea 135-138) — el front
 * tiene su propia copia en src/lib/projectLines.js (Task C3); ambas se
 * validan contra la misma fixture para garantizar paridad.
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
 * Dispara (o re-dispara) el forced alignment en Modal para `songId`.
 * Idempotente: si song_line_timings ya esta en 'processing', no hace nada.
 * @param {string} songId
 * @throws {Error & {status:number}} 409 'Sin audio' si no hay song_audio.
 */
export async function dispatchAlign(songId) {
  const [audio] = await sql`
    SELECT storage_key AS "storageKey" FROM song_audio WHERE song_id = ${songId}
  `;
  if (!audio) {
    const e = new Error('Sin audio');
    e.status = 409;
    throw e;
  }

  const [timings] = await sql`
    SELECT status FROM song_line_timings WHERE song_id = ${songId}
  `;
  if (timings?.status === 'processing') return;

  const audioUrl = await signSongAudioDownload(audio.storageKey);

  const [song] = await sql`SELECT sections FROM songs WHERE id = ${songId}`;
  const lines = projectCanonicalLines(song?.sections);

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
        body: JSON.stringify({ songId, audioUrl, lines, webhookUrl }),
      },
      { timeoutMs: 8000, label: 'Modal align' },
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
      SET status = 'failed', error = ${String(err?.message ?? err)}
      WHERE song_id = ${songId}
    `;
    throw err;
  }
}
