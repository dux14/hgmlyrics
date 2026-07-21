/**
 * cleanup.js — Cron de limpieza del pipeline unificado (song_pipeline_runs).
 * Calca el patron de auth/http de api/stems/cleanup.js.
 *
 * 1) Fases 'running' zombis (run sin updates > 30 min) → 'failed' (timeout),
 *    con CAS: se re-lee `phases` dentro de la transaccion (FOR UPDATE) y solo
 *    se toca la fase si SIGUE en 'running' — evita pisar un webhook de Modal
 *    que completo la fase entre el candidato y el UPDATE.
 * 2) Runs 'created'/'uploading' abandonados (> 24h) → se borran junto con el
 *    storage de su input.
 * 3) Runs 'superseded' → se borra el storage de su input (el prefijo
 *    runs/<runId>/ solo contiene ese objeto); los stems publicados viven en
 *    <songId>/stems/ y no se tocan.
 */
import sql from '../_lib/db.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { timingSafeEqualStr } from '../_lib/crypto.js';
import { deleteSongAudioObject } from '../_lib/storage.js';
import { applyPhaseEvent, runStatusFromPhases, PHASES } from '../_lib/pipeline/state.js';

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

  // 1) Fases zombi: running > 30 min sin actividad → failed (timeout).
  const staleCandidates = await sql`
    SELECT id FROM song_pipeline_runs
    WHERE updated_at < now() - interval '30 minutes'
      AND status NOT IN ('done', 'failed', 'cancelled', 'superseded')
  `;
  let timedOut = 0;
  for (const { id } of staleCandidates) {
    const marked = await sql.begin(async (tx) => {
      const rows = await tx`
        SELECT phases FROM song_pipeline_runs WHERE id = ${id} FOR UPDATE
      `;
      if (rows.length === 0) return false;
      // Re-verificar dentro de la tx: si un webhook completo la fase entre el
      // candidato de arriba y este FOR UPDATE, ya no aparecera como 'running'.
      let phases = rows[0].phases;
      let changed = false;
      for (const phase of PHASES) {
        if (phases[phase]?.status !== 'running') continue;
        const next = applyPhaseEvent(phases, { phase, ok: false, error: 'timeout' });
        if (next) {
          phases = next;
          changed = true;
        }
      }
      if (!changed) return false;
      const status = runStatusFromPhases(phases);
      await tx`
        UPDATE song_pipeline_runs
        SET phases = ${tx.json(phases)}, status = ${status}, updated_at = now()
        WHERE id = ${id}
      `;
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
  // solo se limpia input_path (marca "ya limpiado") si el borrado tuvo exito;
  // si falla, el proximo cron lo reintenta en vez de dejar storage huerfano.
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

  res.status(200).json({
    timedOut,
    abandoned: abandoned.length,
    supersededCleaned: cleared.length,
  });
});
