// Gate humano de letra del pipeline unificado (spec 2026-07-23, contrato v2).
// GET: documento de revision v2 (solo IA: transcripcion + estructura),
// construido bajo demanda y persistido en lyrics_review.review. PUT: aplica
// una accion de edicion sobre el documento (partir/unir renglon o seccion,
// mover/borrar renglon, retipar/renombrar seccion, marcar respiro/
// vocalizacion, offset manual). POST: aprueba (si el doc tiene al menos un
// renglon) — publica la letra al store propio song_pipeline_lyrics (NUNCA
// pisa songs.sections), escribe un shim a song_line_timings para los
// consumidores aguas abajo, marca sync=done (no se despacha en este path),
// deja pitch/clips corriendo, hace swap del audio del run al oficial y
// dispara pitch+clips.
import sql from '../../../_lib/db.js';
import { requireAdmin } from '../../../_lib/auth.js';
import { allowMethods, withErrors } from '../../../_lib/http.js';
import {
  buildReviewDoc,
  applyReviewAction,
  canApprove,
  approvedSnapshot,
  isNil,
} from '../../../_lib/pipeline/lyricsReview.js';
import { suggestLineBreaks } from '../../../_lib/pipeline/phrasing.js';
import { seedIndex, buildTextSuggestions } from '../../../_lib/pipeline/seedLyrics.js';
import { upsertPipelineLyrics, getPipelineLyrics } from '../../../_lib/pipeline/lyricsStore.js';
import {
  applyPhaseEvent,
  phasesAfterLyricsEdit,
  runStatusFromPhases,
} from '../../../_lib/pipeline/state.js';
import { dispatchPhase } from './_dispatch.js';
import { deleteSongAudioObject } from '../../../_lib/storage.js';

// El default de Vercel (10s) no alcanza para el approve: la tx (steps 1-5) +
// el dispatch post-commit a Modal (sync+pitch, cold start incluido) pueden
// superarlo -> 504 con la tx ya commiteada pero sin dispatch. Mismo patron
// que api/pipeline/webhook.js (300s); acá 60 alcanza de sobra.
export const config = { maxDuration: 60 };

// Segmentos de estructura detectados por SongFormer (Task 15, fase
// `structure`), si ya corrieron para este run. Sin fila (structure todavia
// no corrio, o el pipeline es viejo y no la tiene) -> [], mismo criterio que
// studio.js/_dispatch.js con esta tabla. Nada garantiza en el productor
// (stemsAdapter/process.js no ordena) que lleguen ordenados/contiguos, asi
// que se ordenan defensivamente por startMs ascendente y se descartan filas
// con startMs/endMs no finitos antes de pasarlos a buildReviewDoc
// (collapseSegments y splitAtSectionBoundaries asumen orden ascendente),
// mismo criterio que api/songs/[id]/pipeline/_dispatch.js.
async function fetchStructureSegments(songId) {
  const [row] = await sql`SELECT segments FROM song_structure WHERE song_id = ${songId}`;
  const segments = Array.isArray(row?.segments) ? row.segments : [];
  return segments
    .filter((s) => Number.isFinite(s?.startMs) && Number.isFinite(s?.endMs))
    .sort((a, b) => a.startMs - b.startMs);
}

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
 * Devuelve lyrics_review con `review` v2 garantizado: si ya existe un doc v2
 * lo reusa tal cual, si no (sin doc, o un doc v1 en vuelo de antes de F3) lo
 * reconstruye desde transcripcion+song_structure y lo persiste, para no
 * reconstruirlo en cada GET/PUT siguiente.
 * @param {{id:string, lyricsReview:object|null}} run
 * @param {string} songId
 * @param {Array|null} [songSections] `songs.sections` ya leído por el
 *   llamador (getGate siempre lo necesita para textSuggestions); sin pasarlo
 *   se consulta acá, mismo criterio de siempre (putGate no lo tiene a mano).
 * @returns {Promise<{lyricsReview:object}>}
 */
async function ensureReview(run, songId, songSections) {
  const lyricsReview = run.lyricsReview ?? {};
  // Docs v1 persistidos (sin version) se descartan y reconstruyen: la
  // transcripcion y song_structure siguen en el run, no se pierde nada.
  if (lyricsReview.review?.version === 2) return { lyricsReview };

  const transcription = lyricsReview.transcription ?? {
    text: '',
    words: [],
    perLine: [],
    transLines: [],
  };
  const structureSegments = await fetchStructureSegments(songId);
  const seedSections =
    songSections === undefined
      ? ((await sql`SELECT sections FROM songs WHERE id = ${songId}`)[0]?.sections ?? null)
      : songSections;
  const review = buildReviewDoc({ transcription, structureSegments, seedSections });
  const next = { ...lyricsReview, review };
  // CAS: si el run ya no esta en awaiting_lyrics (se aprobo/cancelo entre el
  // findAwaitingRun y este punto) no pisa lyrics_review — mismo criterio que
  // el resto del pipeline (confirm.js/retry.js/approveGate).
  await sql`
    UPDATE song_pipeline_runs SET lyrics_review = ${sql.json(next)}, updated_at = now()
    WHERE id = ${run.id} AND status = 'awaiting_lyrics'
  `;
  return { lyricsReview: next };
}

/** Sugerencias de division por respiracion sobre el doc v2: un renglon con
 * words alineadas a sus tokens puede ofrecer puntos de corte (phrasing.js). */
function buildSuggestions(review) {
  const suggestions = [];
  review.sections.forEach((section, sIdx) => {
    section.lines.forEach((line, lIdx) => {
      const tokens = line.text.split(/\s+/).filter(Boolean);
      if (!Array.isArray(line.words) || line.words.length !== tokens.length) return;
      const breaks = suggestLineBreaks(line.words);
      if (breaks.length > 0) suggestions.push({ section: sIdx, line: lIdx, afterWords: breaks });
    });
  });
  return suggestions;
}

/** Sugerencias de texto (semilla) sobre el doc v2: mismo cálculo para
 * GET y PUT — el PUT también debe devolverlas recalculadas contra el
 * documento resultante, si no una acción que reordena índices (splitLine,
 * mergeLines, moveLine, deleteLine, splitSection, mergeSections) deja las
 * sugerencias del último GET apuntando a renglones equivocados (BLOCKER
 * review tanda C). */
function buildGateSuggestions(review, songSections) {
  return {
    suggestions: buildSuggestions(review),
    textSuggestions: buildTextSuggestions(review, seedIndex(songSections)),
  };
}

async function fetchSongSections(songId) {
  const [song] = await sql`SELECT sections FROM songs WHERE id = ${songId}`;
  return song?.sections ?? null;
}

async function getGate(res, songId) {
  const run = await findAwaitingRun(songId);
  if (!run) {
    res.status(404).json({ error: 'No hay una ejecución esperando revisión de letra' });
    return;
  }
  const songSections = await fetchSongSections(songId);
  const { lyricsReview } = await ensureReview(run, songId, songSections);
  res.status(200).json({
    review: lyricsReview.review,
    canApprove: canApprove(lyricsReview.review),
    ...buildGateSuggestions(lyricsReview.review, songSections),
  });
}

// Centinela de invalidacion de approvedHash al reabrir (revisión post-Task
// 13): NUNCA puede coincidir con un hash real (approvedSnapshot usa sha256
// hex de 64 caracteres, ver lyricsReview.js). El guard de
// process.js:57-76 (LYRICS_DERIVED_PHASES) solo marca stale un webhook
// tardio cuando `approvedHash` es truthy Y distinto del snapshotHash del
// evento — si lo pusieramos en null/undefined el guard se bypassea entero
// (`approvedHash &&` corta corto) y CUALQUIER webhook tardio se aplicaria
// sin chequeo. Con este centinela (truthy, jamas igual a un hash real) todo
// evento de sync/pitch/clips referido al hash viejo queda atrapado por el
// guard, incluida la carrera descrita en el review: un webhook tardio con el
// snapshotHash pre-reopen que antes coincidia con el approvedHash viejo (y
// por lo tanto NO se marcaba stale) ahora siempre difiere del centinela.
const REOPENED_HASH_SENTINEL = 'reopened';

// Reabre una letra ya aprobada (Task 13, robustez): invalida en cascada lo
// que dependia de ella (phasesAfterLyricsEdit, ver state.js) y devuelve el
// run a awaiting_lyrics para volver a editar el mismo documento. Solo valido
// sobre un run que YA paso el gate (status running/done implica, por
// construccion de runStatusFromPhases, que lyrics_review esta done) — sobre
// awaiting_lyrics (todavia sin aprobar) o cualquier otro estado, 409.
async function reopenLyrics(res, songId) {
  let claim;
  try {
    claim = await sql.begin(async (tx) => {
      const rows = await tx`
        SELECT id, song_id AS "songId", status, phases, lyrics_review AS "lyricsReview"
        FROM song_pipeline_runs
        WHERE song_id = ${songId} AND status IN ('running', 'done')
        ORDER BY created_at DESC LIMIT 1
        FOR UPDATE
      `;
      if (rows.length === 0) {
        return { status: 409, error: 'No hay una letra aprobada para reabrir' };
      }
      const run = rows[0];
      const nextPhases = phasesAfterLyricsEdit(run.phases);
      nextPhases.lyrics_review = { ...nextPhases.lyrics_review, status: 'pending', error: null };
      const runStatus = runStatusFromPhases(nextPhases);
      // approvedHash invalidado (ver REOPENED_HASH_SENTINEL arriba): un
      // webhook tardio de sync/pitch/clips referido al snapshot pre-reopen
      // ya no puede colarse comparando igual y reviviendo la fase de stale.
      const nextLyricsReview = { ...run.lyricsReview, approvedHash: REOPENED_HASH_SENTINEL };
      await tx`
        UPDATE song_pipeline_runs
        SET phases = ${tx.json(nextPhases)}, status = ${runStatus},
          lyrics_review = ${tx.json(nextLyricsReview)}, updated_at = now()
        WHERE id = ${run.id}
      `;
      return { ok: true };
    });
  } catch (err) {
    // Índice único parcial song_pipeline_runs_one_active_per_song: el UPDATE
    // mueve este run a 'awaiting_lyrics' (estado activo), lo que puede
    // chocar si YA hay otro run activo para la misma canción (mismo patrón
    // 23505 que createRun en pipeline.js). Se valida el constraint exacto
    // para no tragar otras violaciones de unicidad como si fueran esta.
    if (
      err?.code === '23505' &&
      err?.constraint_name === 'song_pipeline_runs_one_active_per_song'
    ) {
      res.status(409).json({ error: 'Ya hay otra ejecución activa para esta canción' });
      return;
    }
    throw err;
  }

  if (!claim.ok) {
    res.status(claim.status).json({ error: claim.error });
    return;
  }
  res.status(200).json({ success: true });
}

/** Copia SOLO el texto de la letra del pipeline al cancionero (one-way,
 * accion explicita del admin, spec §6). No corre alignment: el karaoke ya
 * consume el store directamente. */
async function publishToSongbook(res, songId) {
  const stored = await getPipelineLyrics(sql, songId);
  if (!stored) {
    res.status(404).json({ error: 'Esta canción no tiene letra de pipeline aprobada' });
    return;
  }
  const sections = stored.sections.map((section) => ({
    type: section.type,
    ...(section.label ? { label: section.label } : {}),
    lines: section.lines.map((line) =>
      // El cancionero no entiende `vocalization`: `annotation` se saltea en el
      // teleprompter (ocultaria la linea) y `spoken` es la representacion mas
      // cercana disponible (se renderiza, sin atribucion de voz).
      line.vocalization ? { text: line.text, spoken: true } : { text: line.text },
    ),
  }));
  const result = await sql`UPDATE songs SET sections = ${sql.json(sections)}, updated_at = now() WHERE id = ${songId}`;
  // La canción pudo borrarse concurrentemente entre el read del store y este
  // UPDATE: si no afecto filas, no reportamos exito (mismo patron TOCTOU que
  // api/songs/[id].js).
  if (result.count === 0) {
    res.status(404).json({ error: 'La canción ya no existe' });
    return;
  }
  res.status(200).json({ success: true });
}

async function putGate(req, res, songId) {
  const action = req.body?.action;
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
    res.status(400).json({ error: 'action es obligatoria' });
    return;
  }
  if (action.type === 'reopen') return reopenLyrics(res, songId);
  if (action.type === 'publishToSongbook') return publishToSongbook(res, songId);

  const run = await findAwaitingRun(songId);
  if (!run) {
    res.status(404).json({ error: 'No hay una ejecución esperando revisión de letra' });
    return;
  }
  const songSections = await fetchSongSections(songId);
  const { lyricsReview } = await ensureReview(run, songId, songSections);

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
  res
    .status(200)
    .json({ review: next, canApprove: canApprove(next), ...buildGateSuggestions(next, songSections) });
}

/** Proyeccion plana {i, startMs, score, interpolated} de las sections del
 * store para el shim song_line_timings. i = posicion plana (misma semantica
 * incremental que projectLines). Renglon sin timing: reparte proporcional
 * dentro del hueco entre la vecina anterior conocida (`prev`/`nextKnown`,
 * vecinos en `known[]`) y la siguiente; monotonia estricta (nunca <=
 * `prevEmitted`, el ULTIMO valor YA EMITIDO) se aplica despues como red de
 * seguridad — son dos marcos de referencia distintos a proposito: uno mira
 * los datos crudos, el otro lo que ya se decidio emitir. */
export function timingLinesFromSections(sections) {
  const flat = sections.flatMap((s) => s.lines);
  const known = flat.map((l) => l.manualStartMs ?? l.startMs);
  const lines = [];
  let i = 0;
  while (i < flat.length) {
    if (!isNil(known[i])) {
      let startMs = known[i];
      // Monotonia estricta: nunca <= al ULTIMO valor ya emitido (prevEmitted),
      // aplica igual a renglones con timing real (ej. dos startMs iguales).
      const prevEmitted = lines[lines.length - 1];
      if (prevEmitted && startMs <= prevEmitted.startMs) startMs = prevEmitted.startMs + 1;
      lines.push({ i, startMs, score: clampScore(flat[i]), interpolated: false });
      i += 1;
      continue;
    }
    // Hueco: [i, gapEnd) son todos nulos. gapEnd es el primer índice conocido
    // (o flat.length si el hueco llega hasta el final).
    let gapEnd = i;
    while (gapEnd < flat.length && isNil(known[gapEnd])) gapEnd += 1;
    const gapLen = gapEnd - i;
    const prev = i > 0 ? known[i - 1] : 0;
    const nextKnown = gapEnd < flat.length ? known[gapEnd] : undefined;
    for (let k = 0; k < gapLen; k += 1) {
      const idx = i + k;
      // Interior (hay endpoint real a ambos lados): reparto proporcional del
      // hueco. Final (sin nextKnown, ej. el outro): no hay endpoint real,
      // incrementos monotonicos simples desde prev.
      let startMs =
        nextKnown === undefined
          ? prev + k + 1
          : prev + Math.round(((nextKnown - prev) * (k + 1)) / (gapLen + 1));
      const prevEmitted = lines[lines.length - 1];
      if (prevEmitted && startMs <= prevEmitted.startMs) startMs = prevEmitted.startMs + 1;
      lines.push({ i: idx, startMs, score: clampScore(flat[idx]), interpolated: true });
    }
    i = gapEnd;
  }
  return lines;
}

// Score valido solo si es number Y cae en [0,1] (mismo criterio que
// api/align/webhook.js:177); fuera de rango o no-numerico -> null.
function clampScore(line) {
  const c = line.confidence;
  return typeof c === 'number' && c >= 0 && c <= 1 ? c : null;
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
      return { status: 409, error: 'La letra no tiene renglones para aprobar' };
    }

    const snapshot = approvedSnapshot(review);
    const nextPhases = applyPhaseEvent(run.phases, { phase: 'lyrics_review', ok: true });
    // El timing ya viene del store (word-timing de la transcripcion): sync no se
    // despacha nunca en el path pipeline — se marca done en esta misma escritura.
    nextPhases.sync = { ...nextPhases.sync, status: 'done', error: null };
    // retries: 0 (fix Important code review, conservado del contrato v1): dispatch
    // fresco de un ciclo nuevo, mismo criterio que phasesAfterLyricsEdit (state.js)
    // -- sin esto el retries acumulado de ciclos reopen/approve previos podia
    // agotar el tope de esta fase en lo que es, para el admin, su primer intento.
    nextPhases.pitch = { ...nextPhases.pitch, status: 'running', retries: 0 };
    // clips ya no espera al webhook de sync: arranca directo desde el approve.
    nextPhases.clips = { ...nextPhases.clips, status: 'running', retries: 0 };
    const runStatus = runStatusFromPhases(nextPhases);
    const nextLyricsReview = { ...run.lyricsReview, approvedHash: snapshot.hash };
    // input_meta.durationSec la persiste confirm.js (best-effort, D1); jsonb
    // preserva el tipo number, pero se coerce igual por si llegó como string.
    const rawDuration = run.inputMeta?.durationSec;
    const numDuration = rawDuration == null ? NaN : Number(rawDuration);
    const durationSec = Number.isFinite(numDuration) ? numDuration : null;

    // Store propio: la letra manual del cancionero (songs.sections) queda intacta.
    await upsertPipelineLyrics(tx, {
      songId,
      runId: run.id,
      sections: snapshot.sections,
      hash: snapshot.hash,
    });
    // Shim de compatibilidad: los consumidores actuales de song_line_timings
    // (clips, SyncFineTuning, ImmersiveView hasta F4) reciben el timing del
    // store. Renglones sin word-timing interpolan el punto medio entre vecinas
    // (monotonia estricta que exige validateLines/seekSyncToLine).
    // bpm_detected/beats se resetean en el swap (mismo criterio que
    // api/songs/[id]/audio.js:100): el audio nuevo del run no puede heredar la
    // rejilla de un align standalone previo (metronomo quedaria stale).
    await tx`
      INSERT INTO song_line_timings (song_id, status, lines, provider, error)
      VALUES (${songId}, 'ready', ${tx.json(timingLinesFromSections(snapshot.sections))}, 'pipeline', NULL)
      ON CONFLICT (song_id) DO UPDATE
        SET status = 'ready', lines = EXCLUDED.lines, provider = 'pipeline', error = NULL,
          bpm_detected = NULL, beats = NULL
    `;
    await tx`
      UPDATE song_pipeline_runs
      SET phases = ${tx.json(nextPhases)}, lyrics_review = ${tx.json(nextLyricsReview)},
        status = ${runStatus}, updated_at = now()
      WHERE id = ${run.id}
    `;
    // Key que este swap va a pisar: si apunta a otro objeto (el caso típico es
    // <songId>/full.mp3, del flujo manual de audio) queda sin ninguna
    // referencia y ninguna ruta de purga la alcanza — ni el DELETE del
    // pipeline ni el cron de limpieza (H7 de la auditoría del 24-jul).
    const prevAudio = await tx`
      SELECT storage_key AS "storageKey" FROM song_audio WHERE song_id = ${songId}
    `;
    const prevAudioKey = prevAudio[0]?.storageKey ?? null;

    // Swap de audio: el mp3 completo del run (ya validado en confirm.js) pasa
    // a ser el oficial de la canción — dispatchPitch/dispatchClips (mas abajo,
    // post-commit) leen song_audio, no el run.
    await tx`
      INSERT INTO song_audio (song_id, storage_key, duration_sec)
      VALUES (${songId}, ${run.inputPath}, ${durationSec})
      ON CONFLICT (song_id) DO UPDATE SET storage_key = EXCLUDED.storage_key, duration_sec = EXCLUDED.duration_sec
    `;

    return {
      ok: true,
      prevAudioKey,
      run: { ...run, phases: nextPhases, lyricsReview: nextLyricsReview },
    };
  });

  if (!claim.ok) {
    res.status(claim.status).json({ error: claim.error });
    return;
  }

  // Best-effort post-commit: un fallo borrando el objeto viejo no puede tumbar
  // un approve ya commiteado (mismo criterio que la purga del pipeline).
  if (claim.prevAudioKey && claim.prevAudioKey !== claim.run.inputPath) {
    await deleteSongAudioObject(claim.prevAudioKey).catch(() => {});
  }

  // En paralelo: cada dispatch aisla su propio fallo (dispatchDerivedPhase
  // nunca rechaza), así que Promise.all no arriesga perder el resultado del
  // otro. sync NUNCA se despacha en este path (queda done desde la propia tx).
  await Promise.all([
    dispatchDerivedPhase('pitch', claim.run),
    dispatchDerivedPhase('clips', claim.run),
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
