/**
 * realign.js — vuelve a correr el alineamiento forzado sobre una letra ya
 * aprobada (sesión 6 del refactor de revisión de letra).
 *
 * A diferencia de `retry.js`, no es un reintento de una fase rota: `sync` está
 * en `done` y el admin quiere tiempos nuevos porque los actuales no le calzan.
 * Por eso guarda el documento anterior en el respaldo de una sola ranura
 * (`previous_sections`/`previous_hash`/`realigned_at`) — es la única forma de
 * volver atrás, ya que el webhook va a pisar los tiempos del documento vivo.
 *
 * Los ajustes manuales por renglón se limpian antes de despachar: corrigen un
 * alineamiento viejo, y arrastrarlos sobre tiempos nuevos los desplaza dos veces.
 */
import sql from '../../../_lib/db.js';
import { requireAdmin } from '../../../_lib/auth.js';
import { allowMethods, withErrors } from '../../../_lib/http.js';
import { dispatchAlign } from '../../../_lib/align.js';
import { getPipelineLyrics, timingLinesFromSections } from '../../../_lib/pipeline/lyricsStore.js';
import { approvedSnapshot, clearManualOffsets } from '../../../_lib/pipeline/lyricsReview.js';
import { runStatusFromPhases } from '../../../_lib/pipeline/state.js';

// Estados de `sync` con su mensaje: el admin tiene que entender por qué no
// puede realinear ahora, y a dónde ir en cambio.
function syncBlocker(status) {
  if (status === 'running') return 'El alineamiento ya está en curso';
  if (status === 'failed' || status === 'stale') {
    return `La sincronización está en '${status}': usá el reintento de la fase, no el realineado`;
  }
  return 'La canción todavía no tiene tiempos alineados';
}

// Deshacer: restaura el respaldo de una sola ranura y NO despacha nada — a
// diferencia del camino feliz de arriba, no hay tiempos nuevos que esperar.
// Todo en una sola tx: restaurar el documento y dejar el respaldo en null
// tienen que quedar atómicos, igual que el respaldo original.
async function handleUndo(res, songId) {
  const result = await sql.begin(async (tx) => {
    const rows = await tx`
      SELECT sections, hash, previous_sections AS "previousSections",
        previous_hash AS "previousHash"
      FROM song_pipeline_lyrics
      WHERE song_id = ${songId}
      FOR UPDATE
    `;
    if (rows.length === 0 || rows[0].previousSections === null) {
      return { status: 409, error: 'No hay un realineado para deshacer' };
    }
    const { previousSections, previousHash } = rows[0];

    // Copia columna a columna (no re-manda previousSections como valor): el
    // documento restaurado es, por definición, el que ya vive en la columna
    // de respaldo.
    await tx`
      UPDATE song_pipeline_lyrics
      SET sections = previous_sections, hash = previous_hash,
        previous_sections = null, previous_hash = null, realigned_at = null
      WHERE song_id = ${songId}
    `;

    // Shim song_line_timings: acá sí queda 'ready' de una — no hay webhook que
    // vaya a completar nada, los tiempos restaurados ya son definitivos.
    await tx`
      INSERT INTO song_line_timings (song_id, status, lines, provider, error)
      VALUES (${songId}, 'ready', ${tx.json(timingLinesFromSections(previousSections))},
        'pipeline', NULL)
      ON CONFLICT (song_id)
      DO UPDATE SET status = 'ready', lines = EXCLUDED.lines, error = NULL
    `;

    const runs = await tx`
      SELECT id, phases, lyrics_review AS "lyricsReview"
      FROM song_pipeline_runs
      WHERE song_id = ${songId}
      ORDER BY created_at DESC LIMIT 1
      FOR UPDATE
    `;
    if (runs.length === 0) {
      return { status: 409, error: 'No hay una ejecución para esta canción' };
    }
    const run = runs[0];
    const nextPhases = structuredClone(run.phases);
    // sync ya estaba 'done' con el hash viejo: deshacer solo lo devuelve ahí.
    // pitch/clips derivan del timing que acabamos de pisar -- 'stale' (no
    // 'pending'), porque no hay ningún dispatch en camino que los reponga.
    nextPhases.sync = { ...nextPhases.sync, status: 'done', error: null };
    nextPhases.pitch = { ...nextPhases.pitch, status: 'stale', error: null };
    nextPhases.clips = { ...nextPhases.clips, status: 'stale', error: null };
    const nextLyricsReview = { ...run.lyricsReview, approvedHash: previousHash };

    await tx`
      UPDATE song_pipeline_runs
      SET phases = ${tx.json(nextPhases)}, status = ${runStatusFromPhases(nextPhases)},
        lyrics_review = ${tx.json(nextLyricsReview)}, updated_at = now()
      WHERE id = ${run.id}
    `;

    return { ok: true };
  });

  if (!result.ok) {
    const err = new Error(result.error);
    err.status = result.status;
    throw err;
  }
  res.status(200).json({ success: true });
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['POST'])) return;
  await requireAdmin(req, sql);
  const songId = req.query.id;
  if (!songId || typeof songId !== 'string') {
    res.status(400).json({ error: 'id es obligatorio' });
    return;
  }

  if (req.query.undo === '1') {
    await handleUndo(res, songId);
    return;
  }

  // Claim transaccional con FOR UPDATE (mismo criterio que retryPhase): leer el
  // run, validar y dejar `sync` en running quedan atómicos, para que dos
  // realineados concurrentes no despachen dos jobs sobre la misma canción.
  const claim = await sql.begin(async (tx) => {
    const runs = await tx`
      SELECT id, song_id AS "songId", status, phases, lyrics_review AS "lyricsReview"
      FROM song_pipeline_runs
      WHERE song_id = ${songId}
      ORDER BY created_at DESC LIMIT 1
      FOR UPDATE
    `;
    if (runs.length === 0) {
      return { status: 404, error: 'No hay una ejecución para esta canción' };
    }
    const run = runs[0];
    if (run.status === 'cancelled' || run.status === 'superseded') {
      return { status: 409, error: `La ejecución está en '${run.status}'` };
    }

    const lyrics = await getPipelineLyrics(tx, songId);
    if (!lyrics) {
      return { status: 409, error: 'No hay letra aprobada para esta canción' };
    }

    if (run.phases?.sync?.status !== 'done') {
      return { status: 409, error: syncBlocker(run.phases?.sync?.status) };
    }

    const snapshot = approvedSnapshot({ sections: clearManualOffsets(lyrics.sections) });

    // El respaldo y el documento limpio en la MISMA escritura: si se separaran,
    // un fallo entre las dos dejaría el respaldo apuntando a un documento que
    // ya no es el anterior. No pasa por upsertPipelineLyrics a propósito — ese
    // camino borra el respaldo (toda escritura del documento lo invalida).
    await tx`
      UPDATE song_pipeline_lyrics
      SET previous_sections = sections, previous_hash = hash, realigned_at = now(),
        sections = ${tx.json(snapshot.sections)}, hash = ${snapshot.hash}
      WHERE song_id = ${songId}
    `;

    // Shim song_line_timings: los consumidores del karaoke leen de acá. Queda
    // en 'processing' hasta que el webhook escriba los tiempos nuevos.
    await tx`
      INSERT INTO song_line_timings (song_id, status, lines, provider, error)
      VALUES (${songId}, 'processing', ${tx.json(timingLinesFromSections(snapshot.sections))},
        'pipeline', NULL)
      ON CONFLICT (song_id)
      DO UPDATE SET status = 'processing', lines = EXCLUDED.lines, error = NULL
    `;

    const nextPhases = structuredClone(run.phases);
    nextPhases.sync = {
      ...nextPhases.sync,
      status: 'running',
      error: null,
      retries: 0,
      startedAt: new Date().toISOString(),
    };
    // pitch y clips derivan del timing: vuelven a pending para que el avance
    // los re-despache cuando `sync` cierre con los tiempos nuevos.
    nextPhases.pitch = { ...nextPhases.pitch, status: 'pending', error: null, retries: 0 };
    nextPhases.clips = { ...nextPhases.clips, status: 'pending', error: null, retries: 0 };
    const runStatus = runStatusFromPhases(nextPhases);

    // El hash aprobado tiene que moverse junto con el documento: dispatchAlign
    // manda snapshot.hash como snapshotHash, e isStaleSnapshot (process.js)
    // descarta cualquier webhook cuyo snapshotHash no coincida con
    // lyrics_review.approvedHash. Sin este UPDATE, el propio webhook del
    // realineado quedaría "stale" y `sync` no saldría nunca de 'running'.
    const nextLyricsReview = { ...run.lyricsReview, approvedHash: snapshot.hash };

    await tx`
      UPDATE song_pipeline_runs
      SET phases = ${tx.json(nextPhases)}, status = ${runStatus},
        lyrics_review = ${tx.json(nextLyricsReview)}, updated_at = now()
      WHERE id = ${run.id}
    `;

    return { ok: true, runId: run.id, phases: nextPhases, hash: snapshot.hash };
  });

  if (!claim.ok) {
    const err = new Error(claim.error);
    err.status = claim.status;
    throw err;
  }

  // El dispatch es una llamada de red: nunca dentro de la transacción con el
  // run lockeado (mismo criterio que retryPhase/cleanup).
  try {
    await dispatchAlign(songId, claim.hash);
  } catch (e) {
    const message = String(e?.message ?? e).slice(0, 300);
    const failedPhases = structuredClone(claim.phases);
    failedPhases.sync = { ...failedPhases.sync, status: 'failed', error: message };
    await sql`
      UPDATE song_pipeline_runs
      SET phases = ${sql.json(failedPhases)}, status = ${runStatusFromPhases(failedPhases)},
        updated_at = now()
      WHERE id = ${claim.runId}
    `;
    const err = new Error(`No se pudo despachar el alineamiento: ${message}`);
    err.status = 502;
    throw err;
  }

  res.status(200).json({ success: true });
});
