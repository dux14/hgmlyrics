/**
 * process.js — Aplica el evento de webhook de una fase del pipeline unificado
 * al run persistido, con CAS (SELECT ... FOR UPDATE dentro de una transacción)
 * y publicación progresiva de resultados (song_stems / song_pitch_analysis /
 * song_section_audio se actualizan en la misma transacción que `phases`).
 * Extraída de api/pipeline/webhook.js para que B7 (retry/replay de fases) la
 * reuse sin duplicar la lógica de CAS ni de publicación.
 */
import { applyPhaseEvent, runStatusFromPhases } from './state.js';

// Estados de run donde un evento de fase todavía puede aplicar efectos.
// Mismo set que el índice único parcial song_pipeline_runs_one_active_per_song
// y que los filtros WHERE status IN (...) del resto del pipeline.
export const ACTIVE_RUN_STATUSES = new Set([
  'created',
  'uploading',
  'processing',
  'awaiting_lyrics',
  'running',
]);

// Fases derivadas de la letra aprobada: si llegan con un snapshotHash viejo
// (el admin editó la letra mientras Modal seguía procesando el run anterior),
// NO se publican — quedan 'stale'. Esto cubre el gap de que applyPhaseEvent
// por sí solo acepta cualquier evento sobre una fase no-terminal, incluidos
// los que llegan tarde referidos a una letra ya reemplazada (carry del review
// plan A, generalizado de pitch a sync+pitch+clips).
const LYRICS_DERIVED_PHASES = new Set(['sync', 'pitch', 'clips']);

/**
 * @param {import('postgres').Sql} sql
 * @param {string} runId
 * @param {{phase:string, ok:boolean, partial?:boolean, tracks?:object,
 *          artifacts?:object, error?:string, snapshotHash?:string, payload?:object,
 *          durationSec?:number}} event
 * @returns {Promise<{status:string, next:object, songId:string}
 *   | {ignored:true} | {stale:true} | null>} null si el run no existe.
 */
export async function applyPipelinePhaseEvent(sql, runId, event) {
  return sql.begin(async (tx) => {
    const rows = await tx`
      SELECT id, song_id AS "songId", status, phases, lyrics_review AS "lyricsReview",
        input_meta AS "inputMeta"
      FROM song_pipeline_runs
      WHERE id = ${runId}
      FOR UPDATE
    `;
    if (rows.length === 0) return null;
    const run = rows[0];

    // Guarda: un webhook tardío de Modal sobre un run ya no-activo (cancelled/
    // superseded/done/failed) no debe aplicar ningún efecto — song_stems/
    // song_pitch_analysis/song_section_audio se indexan por song_id, no por
    // run_id, y pisarían los datos de un run más nuevo para la misma canción.
    if (!ACTIVE_RUN_STATUSES.has(run.status)) return { ignored: true };

    const approvedHash = run.lyricsReview?.approvedHash;
    if (
      LYRICS_DERIVED_PHASES.has(event.phase) &&
      event.snapshotHash &&
      approvedHash &&
      event.snapshotHash !== approvedHash
    ) {
      const stalePhases = structuredClone(run.phases);
      // Solo tiene sentido marcar stale si la fase no es ya terminal (done/failed
      // ya no admite más eventos, misma regla de applyPhaseEvent).
      if (!['done', 'failed'].includes(stalePhases[event.phase]?.status)) {
        stalePhases[event.phase] = { ...stalePhases[event.phase], status: 'stale' };
        await tx`
          UPDATE song_pipeline_runs
          SET phases = ${tx.json(stalePhases)}, updated_at = now()
          WHERE id = ${runId}
        `;
      }
      return { stale: true };
    }

    const next = applyPhaseEvent(run.phases, event);
    if (next === null) return { ignored: true };

    // Publicación progresiva: efectos por fase, en la misma transacción.
    // Guard de pertenencia (mismo patrón que api/stems/jobs/[id].js SEC-07): el
    // servidor mismo manda las keys esperadas en el dispatch (pipelineStemKey en
    // api/_lib/storage.js), así que una key que no empiece por `${songId}/` no
    // puede venir de un dispatch legítimo — se descarta en vez de insertarla,
    // para no dejar firmable una key ajena vía api/songs/[id]/studio.js.
    const belongsToSong = (storageKey) =>
      typeof storageKey === 'string' && storageKey.startsWith(`${run.songId}/`);

    if (event.phase === 'stems' && event.tracks) {
      for (const [kind, storageKey] of Object.entries(event.tracks)) {
        if (!belongsToSong(storageKey)) continue;
        await tx`
          INSERT INTO song_stems (song_id, kind, storage_key, run_id)
          VALUES (${run.songId}, ${kind}, ${storageKey}, ${runId})
          ON CONFLICT (song_id, kind)
          DO UPDATE SET storage_key = EXCLUDED.storage_key, run_id = EXCLUDED.run_id
        `;
      }
    }

    // durationSec server-side (Task 7): S1/S3 calculan la duración real del
    // audio de entrada (len(samples)/sr) en Modal y la mandan en el result.
    // Solo se persiste si input_meta.durationSec aún no está seteada — el
    // browser la manda best-effort en confirm.js (D1) y llega primero; ese
    // valor tiene prioridad, este es solo el fallback cuando el browser falló.
    // Misma validación que confirm.js:54 (finito y no negativo) para que un
    // durationSec corrupto (NaN/Infinity/negativo) nunca llegue a persistirse.
    const hasValidDurationSec =
      typeof event.durationSec === 'number' &&
      Number.isFinite(event.durationSec) &&
      event.durationSec >= 0;
    if (event.phase === 'stems' && hasValidDurationSec && run.inputMeta?.durationSec == null) {
      await tx`
        UPDATE song_pipeline_runs
        SET input_meta = COALESCE(input_meta, '{}'::jsonb) || ${tx.json({ durationSec: event.durationSec })}::jsonb
        WHERE id = ${runId}
      `;
    }

    if (event.phase === 'structure' && event.ok && !event.partial && event.payload?.segments) {
      await tx`
        INSERT INTO song_structure (song_id, run_id, segments, model)
        VALUES (${run.songId}, ${runId}, ${tx.json(event.payload.segments)}, ${event.payload.model ?? null})
        ON CONFLICT (song_id)
        DO UPDATE SET run_id = EXCLUDED.run_id, segments = EXCLUDED.segments, model = EXCLUDED.model, updated_at = now()
      `;
    }

    let lyricsReview = run.lyricsReview ?? {};
    if (event.phase === 'transcription' && event.ok && !event.partial && event.payload) {
      // transLines (plan C, gate de letra): lineas de texto transcritas en el
      // mismo orden que `words` — lo usa buildReviewDoc para las 3 fuentes y
      // suggestLineBreaks para mapear palabras a renglon. Opcional: un
      // payload sin transLines (apps Modal viejas) degrada con gracia a []
      // en lyricsReview.js/lyrics.js, sin romper el resto del gate.
      const { text, words, perLine, transLines } = event.payload;
      lyricsReview = { ...lyricsReview, transcription: { text, words, perLine, transLines } };
    }

    if (event.phase === 'pitch' && event.ok && !event.partial) {
      const analysis = event.payload?.analysis ?? {};
      const artifacts = event.artifacts ?? {};
      await tx`
        INSERT INTO song_pitch_analysis (song_id, run_id, analysis, artifacts)
        VALUES (${run.songId}, ${runId}, ${tx.json(analysis)}, ${tx.json(artifacts)})
        ON CONFLICT (song_id)
        DO UPDATE SET run_id = EXCLUDED.run_id, analysis = EXCLUDED.analysis, artifacts = EXCLUDED.artifacts
      `;
    }

    if (
      event.phase === 'clips' &&
      event.ok &&
      !event.partial &&
      Array.isArray(event.payload?.clips)
    ) {
      for (const clip of event.payload.clips) {
        if (!belongsToSong(clip.storageKey)) continue;
        // ON CONFLICT sobre el mismo índice único de song_section_audio
        // (song_id, section_index, coalesce(voice_scope,'')). El WHERE del
        // DO UPDATE es la guarda: si la fila existente es un clip manual
        // (run_id NULL), el conflicto no actualiza nada — no se pisa.
        await tx`
          INSERT INTO song_section_audio (song_id, section_index, voice_scope, storage_key, duration_sec, run_id)
          VALUES (${run.songId}, ${clip.sectionIndex}, ${clip.voiceScope ?? null}, ${clip.storageKey}, ${clip.durationSec ?? null}, ${runId})
          ON CONFLICT (song_id, section_index, coalesce(voice_scope, ''))
          DO UPDATE SET storage_key = EXCLUDED.storage_key, duration_sec = EXCLUDED.duration_sec, run_id = EXCLUDED.run_id
          WHERE song_section_audio.run_id IS NOT NULL
        `;
      }
    }

    const status = runStatusFromPhases(next);
    await tx`
      UPDATE song_pipeline_runs
      SET phases = ${tx.json(next)}, status = ${status}, lyrics_review = ${tx.json(lyricsReview)}, updated_at = now()
      WHERE id = ${runId}
    `;

    return { status, next, songId: run.songId };
  });
}
