// Gate humano de letra del pipeline unificado (spec 2026-07-20, Task C2).
// GET: documento de revision (diff de 3 fuentes), construido bajo demanda y
// persistido en lyrics_review.review. PUT: aplica una accion de edicion
// sobre el documento (resolver conflicto, partir/unir renglon o seccion,
// aceptar/rechazar vocalizacion). POST: aprueba (si no quedan conflictos ni
// vocalizaciones pendientes) — publica la letra a songs.sections, hace el
// snapshot con hash, hace swap del audio del run al oficial y dispara
// sync+pitch.
import sql from '../../../_lib/db.js';
import { requireAdmin } from '../../../_lib/auth.js';
import { allowMethods, withErrors } from '../../../_lib/http.js';
import {
  buildReviewDoc,
  applyReviewAction,
  reviewTemperature,
  canApprove,
  approvedSnapshot,
  isNil,
} from '../../../_lib/pipeline/lyricsReview.js';
import { suggestLineBreaks } from '../../../_lib/pipeline/phrasing.js';
import { applyPhaseEvent, runStatusFromPhases } from '../../../_lib/pipeline/state.js';
import { dispatchPhase } from './_dispatch.js';

// El default de Vercel (10s) no alcanza para el approve: la tx (steps 1-5) +
// el dispatch post-commit a Modal (sync+pitch, cold start incluido) pueden
// superarlo -> 504 con la tx ya commiteada pero sin dispatch. Mismo patron
// que api/pipeline/webhook.js (300s); acá 60 alcanza de sobra.
export const config = { maxDuration: 60 };

async function findAwaitingRun(songId) {
  const rows = await sql`
    SELECT id, song_id AS "songId", status, phases, input_path AS "inputPath",
      input_meta AS "inputMeta", lyrics_review AS "lyricsReview"
    FROM song_pipeline_runs
    WHERE song_id = ${songId} AND status = 'awaiting_lyrics'
    ORDER BY created_at DESC LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Devuelve lyrics_review con `review` garantizado (si ya existe lo reusa tal
 * cual, si no lo construye desde transcripcion+sections+canonica y lo
 * persiste, para no reconstruirlo en cada GET/PUT siguiente) junto con
 * `dbSections`, en UN solo round-trip a `songs` (lo necesita tanto el build
 * como las suggestions del GET — se evita pedirlo dos veces).
 * @param {{id:string, lyricsReview:object|null}} run
 * @param {string} songId
 * @returns {Promise<{lyricsReview:object, dbSections:Array}>}
 */
async function ensureReview(run, songId) {
  const [songRow] = await sql`SELECT sections FROM songs WHERE id = ${songId}`;
  const dbSections = songRow?.sections ?? [];

  const lyricsReview = run.lyricsReview ?? {};
  if (lyricsReview.review) return { lyricsReview, dbSections };

  const [canonicalRow] = await sql`SELECT content FROM song_lyrics_canonical WHERE song_id = ${songId}`;
  const canonical = canonicalRow?.content ?? null;
  const transcription = lyricsReview.transcription ?? { text: '', words: [], perLine: [] };

  const review = buildReviewDoc({ dbSections, canonical, transcription });
  const next = { ...lyricsReview, review };
  // CAS: si el run ya no esta en awaiting_lyrics (se aprobo/cancelo entre el
  // findAwaitingRun y este punto) no pisa lyrics_review — mismo criterio que
  // el resto del pipeline (confirm.js/retry.js/approveGate).
  await sql`
    UPDATE song_pipeline_runs SET lyrics_review = ${sql.json(next)}, updated_at = now()
    WHERE id = ${run.id} AND status = 'awaiting_lyrics'
  `;
  return { lyricsReview: next, dbSections };
}

/**
 * Sugerencias de division por respiracion (spec decision 11, phrasing.js),
 * una por cada renglon db con transcripcion emparejada. Los `words` de la
 * transcripcion vienen en un solo array plano SIN limite de renglon; se
 * reconstruye el limite asumiendo el mismo orden que produce align_app.py
 * (las palabras de cada segmento se anexan en el mismo orden que
 * `transLines`), cortando por cantidad de palabras de cada linea transcrita.
 * @param {{dbSections:Array, transcription:object|undefined}} args
 * @returns {Array<{section:number, line:number, afterWords:number[]}>}
 */
function buildSuggestions({ dbSections, transcription }) {
  const perLine = transcription?.perLine ?? [];
  const transLines = transcription?.transLines ?? [];
  const words = transcription?.words ?? [];
  if (transLines.length === 0 || words.length === 0) return [];

  const flatDbLines = [];
  dbSections.forEach((section, sIdx) => {
    (section.lines || []).forEach((_line, lIdx) => flatDbLines.push({ section: sIdx, line: lIdx }));
  });

  const suggestions = [];
  let cursor = 0;
  transLines.forEach((lineText, transIndex) => {
    const wordCount = (lineText || '').split(/\s+/).filter(Boolean).length;
    const lineWords = words.slice(cursor, cursor + wordCount);
    cursor += wordCount;

    const entry = perLine.find((p) => p.transIndex === transIndex);
    if (!entry || isNil(entry.dbIndex)) return;
    const coord = flatDbLines[entry.dbIndex];
    if (!coord) return;

    const breaks = suggestLineBreaks(lineWords);
    if (breaks.length > 0) suggestions.push({ section: coord.section, line: coord.line, afterWords: breaks });
  });
  return suggestions;
}

async function getGate(res, songId) {
  const run = await findAwaitingRun(songId);
  if (!run) {
    res.status(404).json({ error: 'No hay una ejecución esperando revisión de letra' });
    return;
  }
  const { lyricsReview, dbSections } = await ensureReview(run, songId);
  const suggestions = buildSuggestions({ dbSections, transcription: lyricsReview.transcription });
  res.status(200).json({
    review: lyricsReview.review,
    temperature: reviewTemperature(lyricsReview.review),
    canApprove: canApprove(lyricsReview.review),
    suggestions,
  });
}

async function putGate(req, res, songId) {
  const action = req.body?.action;
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
    res.status(400).json({ error: 'action es obligatoria' });
    return;
  }
  const run = await findAwaitingRun(songId);
  if (!run) {
    res.status(404).json({ error: 'No hay una ejecución esperando revisión de letra' });
    return;
  }
  const { lyricsReview } = await ensureReview(run, songId);

  let next;
  try {
    next = applyReviewAction(lyricsReview.review, action);
  } catch (err) {
    if (err instanceof RangeError) {
      res.status(422).json({ error: err.message });
      return;
    }
    throw err;
  }

  const nextLyricsReview = { ...lyricsReview, review: next };
  // CAS: mismo criterio que confirm.js/retry.js/approveGate — no pisa el doc
  // si el run ya dejo awaiting_lyrics entre el findAwaitingRun y este UPDATE.
  await sql`
    UPDATE song_pipeline_runs SET lyrics_review = ${sql.json(nextLyricsReview)}, updated_at = now()
    WHERE id = ${run.id} AND status = 'awaiting_lyrics'
  `;
  res.status(200).json({ review: next, temperature: reviewTemperature(next), canApprove: canApprove(next) });
}

// Fases derivadas de la letra recien aprobada. Fallo de dispatch NO debe
// romper la respuesta 200 (la aprobacion en si ya se persistio): la fase que
// se intento arrancar queda failed y admite retry vía retry.js (mismo
// criterio de aislamiento de fallas que confirm.js/retry.js, pero acá el
// resultado global de la aprobación no depende del dispatch).
async function dispatchDerivedPhase(phase, run) {
  try {
    await dispatchPhase(phase, run);
  } catch (err) {
    await sql.begin(async (tx) => {
      const rows = await tx`SELECT phases FROM song_pipeline_runs WHERE id = ${run.id} FOR UPDATE`;
      if (rows.length === 0) return;
      const failedPhases = applyPhaseEvent(rows[0].phases, {
        phase,
        ok: false,
        error: String(err?.message ?? err).slice(0, 300),
      });
      if (!failedPhases) return; // fase ya terminal (CAS de applyPhaseEvent): nada que hacer.
      await tx`
        UPDATE song_pipeline_runs SET phases = ${tx.json(failedPhases)}, updated_at = now()
        WHERE id = ${run.id}
      `;
    });
  }
}

async function approveGate(res, songId) {
  const claim = await sql.begin(async (tx) => {
    const rows = await tx`
      SELECT id, song_id AS "songId", status, phases, input_path AS "inputPath",
        input_meta AS "inputMeta", lyrics_review AS "lyricsReview"
      FROM song_pipeline_runs
      WHERE song_id = ${songId} AND status = 'awaiting_lyrics'
      ORDER BY created_at DESC LIMIT 1
      FOR UPDATE
    `;
    if (rows.length === 0) {
      return { status: 404, error: 'No hay una ejecución esperando revisión de letra' };
    }
    const run = rows[0];
    const review = run.lyricsReview?.review;
    if (!review || !canApprove(review)) {
      return { status: 409, error: 'La letra todavía tiene conflictos o vocalizaciones sin resolver' };
    }

    const snapshot = approvedSnapshot(review);
    const nextPhases = applyPhaseEvent(run.phases, { phase: 'lyrics_review', ok: true });
    const runStatus = runStatusFromPhases(nextPhases);
    const nextLyricsReview = { ...run.lyricsReview, approvedHash: snapshot.hash };
    // input_meta.durationSec la persiste confirm.js (best-effort, D1); jsonb
    // preserva el tipo number, pero se coerce igual por si llegó como string.
    const rawDuration = run.inputMeta?.durationSec;
    const numDuration = rawDuration == null ? NaN : Number(rawDuration);
    const durationSec = Number.isFinite(numDuration) ? numDuration : null;

    await tx`UPDATE songs SET sections = ${tx.json(snapshot.sections)}, updated_at = now() WHERE id = ${songId}`;
    await tx`
      UPDATE song_pipeline_runs
      SET phases = ${tx.json(nextPhases)}, lyrics_review = ${tx.json(nextLyricsReview)},
        status = ${runStatus}, updated_at = now()
      WHERE id = ${run.id}
    `;
    // Swap de audio: el mp3 completo del run (ya validado en confirm.js) pasa
    // a ser el oficial de la canción — dispatchAlign/dispatchPitch (mas
    // abajo, post-commit) leen song_audio, no el run.
    await tx`
      INSERT INTO song_audio (song_id, storage_key, duration_sec)
      VALUES (${songId}, ${run.inputPath}, ${durationSec})
      ON CONFLICT (song_id) DO UPDATE SET storage_key = EXCLUDED.storage_key, duration_sec = EXCLUDED.duration_sec
    `;

    return { ok: true, run: { ...run, phases: nextPhases, lyricsReview: nextLyricsReview } };
  });

  if (!claim.ok) {
    res.status(claim.status).json({ error: claim.error });
    return;
  }

  // En paralelo: cada dispatch aisla su propio fallo (dispatchDerivedPhase
  // nunca rechaza), así que Promise.all no arriesga perder el resultado del
  // otro. Secuencial duplicaba la latencia hacia Modal (cold start incluido)
  // y fue la causa real del 504 en el smoke E2E.
  await Promise.all([
    dispatchDerivedPhase('sync', claim.run),
    dispatchDerivedPhase('pitch', claim.run),
  ]);

  res.status(200).json({ success: true });
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET', 'PUT', 'POST'])) return;
  await requireAdmin(req, sql);
  const songId = req.query.id;
  if (!songId || typeof songId !== 'string') {
    res.status(400).json({ error: 'id es obligatorio' });
    return;
  }
  if (req.method === 'GET') return getGate(res, songId);
  if (req.method === 'PUT') return putGate(req, res, songId);
  return approveGate(res, songId);
});
