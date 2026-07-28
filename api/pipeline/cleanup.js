/**
 * cleanup.js — Cron de limpieza del pipeline unificado (song_pipeline_runs).
 * Calca el patrón de auth/http de api/stems/cleanup.js.
 *
 * 0) Reintentos automáticos diferidos (`next_retry_at` vencido) → se disparan
 *    vía `retryPhase(..., { auto: true })`. Va ANTES del paso 1 (zombis)
 *    porque `retryPhase` deja la fase en 'running' con `updated_at = now()`,
 *    así el paso 1 no la mata en la misma corrida.
 * 1) Fases 'running' zombis (run sin updates > 30 min) → 'failed' (timeout),
 *    con CAS: se re-lee `phases` dentro de la transacción (FOR UPDATE) y solo
 *    se toca la fase si SIGUE en 'running' — evita pisar un webhook de Modal
 *    que completó la fase entre el candidato y el UPDATE. Si la fase que
 *    queda failed pasa `shouldAutoRetry`, se programa `next_retry_at` (nunca
 *    inmediato: un job que se colgó 30 min no es un transitorio de segundos).
 * 2) Runs 'created'/'uploading' abandonados (> 24h) → se borran junto con el
 *    storage de su input.
 * 3) Runs 'superseded' → se borra el storage de su input (el prefijo
 *    runs/<runId>/ solo contiene ese objeto); los stems publicados viven en
 *    <songId>/stems/ y no se tocan.
 * 4) Runs 'cancelled' (purgeRun, api/songs/[id]/pipeline.js) → barre las pistas
 *    y clips que registró ESE run (song_stems/song_section_audio por run_id),
 *    por si un job de Modal ya despachado (signed PUT URLs) siguió subiendo
 *    después del borrado del run; process.js ignora esos jobs por run
 *    cancelado, pero nadie más barría esos objetos. Nunca por prefijo de
 *    canción: <songId>/stems|clips/ es espacio compartido con los runs vivos y
 *    con lo ya publicado.
 */
import sql from '../_lib/db.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { timingSafeEqualStr } from '../_lib/crypto.js';
import { deleteSongAudioObject, deleteSongAudioObjects } from '../_lib/storage.js';
import { applyPhaseEvent, runStatusFromPhases, PHASES } from '../_lib/pipeline/state.js';
import { shouldAutoRetry } from '../_lib/pipeline/autoRetry.js';
import { retryPhase } from '../_lib/pipeline/retryPhase.js';

// Mismo texto que escribe el paso 1 al marcar una fase zombi. classifyFailure
// (autoRetry.js) lo trata como transitorio: no matchea ningún patrón permanente.
const ZOMBIE_ERROR = 'La fase tardó demasiado y fue cancelada.';

// Vercel cron manda Authorization: Bearer ${CRON_SECRET}
export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET'])) return;
  const auth = req.headers?.authorization ?? '';
  const secret = process.env.CRON_SECRET;
  const expected = secret ? `Bearer ${secret}` : null;
  if (!expected || !timingSafeEqualStr(auth, expected)) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }

  // 0) Reintentos diferidos: runs con next_retry_at vencido. El dispatch de
  // retryPhase es una llamada de red — nunca corre dentro de una tx con el
  // run lockeado, por eso este paso vive fuera de sql.begin().
  const dueRuns = await sql`
    SELECT id, song_id AS "songId", phases, auto_retries AS "autoRetries"
    FROM song_pipeline_runs
    WHERE next_retry_at IS NOT NULL AND next_retry_at <= now()
      AND status IN ('created', 'uploading', 'processing', 'awaiting_lyrics', 'running')
    LIMIT 50
  `;
  let autoRetried = 0;
  // allSettled: un run que explota (dispatch caído, fila borrada entre medio)
  // no puede abortar la corrida ni el resto de los pasos.
  await Promise.allSettled(
    dueRuns.map(async (run) => {
      let retriedAny = false;
      for (const phase of PHASES) {
        const phaseState = run.phases[phase];
        if (phaseState?.status !== 'failed') continue;
        if (
          !shouldAutoRetry({
            phase,
            phaseState,
            runAutoRetries: run.autoRetries || 0,
            errorText: phaseState.error,
            timeout: false,
          })
        ) {
          continue;
        }
        retriedAny = true;
        const result = await retryPhase(sql, { songId: run.songId, phase, auto: true });
        if (result.ok) autoRetried += 1;
      }
      // Ninguna fase calificó: limpiar next_retry_at para no re-escanear esta
      // fila en cada corrida horaria (el estado no va a cambiar solo).
      if (!retriedAny) {
        await sql`UPDATE song_pipeline_runs SET next_retry_at = NULL WHERE id = ${run.id}`;
      }
    }),
  );

  // 1) Fases zombi: running > 30 min sin actividad → failed (timeout).
  // LIMIT 200: el resto lo procesa la próxima corrida horaria (maxDuration=60).
  const staleCandidates = await sql`
    SELECT id FROM song_pipeline_runs
    WHERE updated_at < now() - interval '30 minutes'
      AND status NOT IN ('done', 'failed', 'cancelled', 'superseded')
    LIMIT 200
  `;
  let timedOut = 0;
  for (const { id } of staleCandidates) {
    const marked = await sql.begin(async (tx) => {
      const rows = await tx`
        SELECT phases, auto_retries AS "autoRetries" FROM song_pipeline_runs WHERE id = ${id} FOR UPDATE
      `;
      if (rows.length === 0) return false;
      // Re-verificar dentro de la tx: si un webhook completó la fase entre el
      // candidato de arriba y este FOR UPDATE, ya no aparecerá como 'running'.
      let phases = rows[0].phases;
      let changed = false;
      let scheduleRetry = false;
      for (const phase of PHASES) {
        if (phases[phase]?.status !== 'running') continue;
        const next = applyPhaseEvent(phases, {
          phase,
          ok: false,
          error: ZOMBIE_ERROR,
        });
        if (next) {
          phases = next;
          changed = true;
          // Diferido siempre: un job colgado 30 min no es un transitorio de
          // segundos (a diferencia del `ok:false` inmediato del webhook).
          if (
            shouldAutoRetry({
              phase,
              phaseState: next[phase],
              runAutoRetries: rows[0].autoRetries || 0,
              errorText: ZOMBIE_ERROR,
              timeout: false,
            })
          ) {
            scheduleRetry = true;
          }
        }
      }
      if (!changed) return false;
      const status = runStatusFromPhases(phases);
      if (scheduleRetry) {
        await tx`
          UPDATE song_pipeline_runs
          SET phases = ${tx.json(phases)}, status = ${status},
              next_retry_at = now() + interval '10 minutes', updated_at = now()
          WHERE id = ${id}
        `;
      } else {
        await tx`
          UPDATE song_pipeline_runs
          SET phases = ${tx.json(phases)}, status = ${status}, updated_at = now()
          WHERE id = ${id}
        `;
      }
      return true;
    });
    if (marked) timedOut += 1;
  }

  // 2) Runs abandonados: created/uploading > 24h → borrar fila + storage de input.
  const abandoned = await sql`
    DELETE FROM song_pipeline_runs
    WHERE status IN ('created', 'uploading') AND created_at < now() - interval '24 hours'
    RETURNING id, input_path
  `;
  await Promise.allSettled(
    abandoned.filter((run) => run.input_path).map((run) => deleteSongAudioObject(run.input_path)),
  );

  // 3) Runs superseded: borrar storage de su input. Igual que stems/cleanup,
  // solo se limpia input_path (marca "ya limpiado") si el borrado tuvo éxito;
  // si falla, el próximo cron lo reintenta en vez de dejar storage huérfano.
  const superseded = await sql`
    SELECT id, input_path FROM song_pipeline_runs
    WHERE status = 'superseded' AND input_path IS NOT NULL
  `;
  const purgeResults = await Promise.allSettled(
    superseded.map((run) => deleteSongAudioObject(run.input_path)),
  );
  const cleared = superseded.filter((_, i) => purgeResults[i].status === 'fulfilled');
  for (const run of cleared) {
    await sql`
      UPDATE song_pipeline_runs SET input_path = NULL, updated_at = now()
      WHERE id = ${run.id}
    `;
  }

  // 4) Runs 'cancelled' (purgeRun) con input_path aún seteado: barrer lo que
  // subió ESE run (jobs de Modal despachados antes del purge que siguieron
  // subiendo después) además de su input. Igual criterio que 'superseded':
  // solo se limpia input_path (marca "ya barrido") si el sweep tuvo éxito; si
  // falla, la próxima corrida reintenta.
  //
  // El barrido va por `run_id`, NUNCA por prefijo de canción: <songId>/stems|clips/
  // guarda las pistas PUBLICADAS que la app reproduce, compartidas por todos los
  // runs de esa canción. Listar el prefijo (lo que hacía deleteSongAudioPrefix
  // hasta el 28-jul-2026) borraba las pistas del run vivo y las ya publicadas —
  // el run quedaba con song_stems apuntando a objetos inexistentes y sus fases
  // morían con "Object not found" al firmar.
  //
  // El NOT EXISTS es la otra mitad de la guarda: las keys son por canción
  // (`<songId>/stems/lead.mp3`), así que un run posterior reescribe la misma
  // ruta que registró el cancelado. Solo se borra la key que ninguna otra fila
  // referencia — ni de otro run, ni manual (run_id NULL).
  const cancelledRuns = await sql`
    SELECT id, song_id, input_path FROM song_pipeline_runs
    WHERE status = 'cancelled' AND input_path IS NOT NULL
  `;
  const cancelledResults = await Promise.allSettled(
    cancelledRuns.map(async (run) => {
      const owned = await sql`
        SELECT s.storage_key FROM song_stems s
         WHERE s.run_id = ${run.id}
           AND NOT EXISTS (
             SELECT 1 FROM song_stems o
              WHERE o.storage_key = s.storage_key
                AND o.run_id IS DISTINCT FROM ${run.id})
        UNION
        SELECT a.storage_key FROM song_section_audio a
         WHERE a.run_id = ${run.id}
           AND NOT EXISTS (
             SELECT 1 FROM song_section_audio o
              WHERE o.storage_key = a.storage_key
                AND o.run_id IS DISTINCT FROM ${run.id})
      `;
      await deleteSongAudioObjects(owned.map((row) => row.storage_key));
      await deleteSongAudioObject(run.input_path);
    }),
  );
  const cancelledCleared = cancelledRuns.filter(
    (_, i) => cancelledResults[i].status === 'fulfilled',
  );
  for (const run of cancelledCleared) {
    await sql`
      UPDATE song_pipeline_runs SET input_path = NULL, updated_at = now()
      WHERE id = ${run.id}
    `;
  }

  res.status(200).json({
    autoRetried,
    timedOut,
    abandoned: abandoned.length,
    supersededCleaned: cleared.length,
    cancelledCleaned: cancelledCleared.length,
  });
});
