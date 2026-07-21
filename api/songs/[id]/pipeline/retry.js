// Reintenta una fase failed/stale del run activo (spec Task B2): valida
// dependencias con canStartPhase, resetea la fase a pending/running y
// re-despacha. NO reintenta internamente (a diferencia de confirm.js): este
// endpoint ES el reintento explícito que pide el admin.
import sql from '../../../_lib/db.js';
import { requireAdmin } from '../../../_lib/auth.js';
import { allowMethods, withErrors } from '../../../_lib/http.js';
import { canStartPhase } from '../../../_lib/pipeline/state.js';
import { dispatchPhase } from './_dispatch.js';

const RETRYABLE_PHASES = new Set(['stems', 'transcription', 'sync', 'pitch', 'clips']);

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['POST'])) return;
  await requireAdmin(req, sql);
  const songId = req.query.id;
  if (!songId || typeof songId !== 'string') {
    res.status(400).json({ error: 'id es obligatorio' });
    return;
  }

  const { phase } = req.body ?? {};
  if (!RETRYABLE_PHASES.has(phase)) {
    res.status(400).json({ error: `Fase '${phase}' no admite reintento` });
    return;
  }

  // Leer-validar-claim en una sola tx con FOR UPDATE: evita el TOCTOU del
  // UPDATE ciego anterior (sin predicado de estado, y `claimed.count===0`
  // como código muerto que nunca detectaba nada). El SELECT, la validación de
  // failed/stale y de dependencias (canStartPhase), y el UPDATE a 'running'
  // quedan atómicos bajo el lock de fila.
  const claim = await sql.begin(async (tx) => {
    const rows = await tx`
      SELECT id, song_id AS "songId", status, phases, input_path AS "inputPath"
      FROM song_pipeline_runs
      WHERE song_id = ${songId}
        AND status IN ('created', 'uploading', 'processing', 'awaiting_lyrics', 'running')
      ORDER BY created_at DESC LIMIT 1
      FOR UPDATE
    `;
    if (rows.length === 0) {
      return { status: 404, error: 'No hay una ejecución activa para esta canción' };
    }
    const run = rows[0];

    const current = run.phases[phase]?.status;
    if (current !== 'failed' && current !== 'stale') {
      return { status: 409, error: `La fase '${phase}' no está en failed/stale (está en ${current})` };
    }

    // canStartPhase exige status pending|stale — 'failed' se resetea primero, y
    // recién sobre ese estado se valida el DAG (evita re-despachar sin las
    // dependencias listas).
    const pendingPhases = structuredClone(run.phases);
    pendingPhases[phase] = { status: 'pending', error: null, tracks: undefined, artifacts: undefined };
    if (!canStartPhase(pendingPhases, phase)) {
      return { status: 409, error: `Las dependencias de '${phase}' no están listas` };
    }

    const runningPhases = structuredClone(pendingPhases);
    runningPhases[phase].status = 'running';

    await tx`
      UPDATE song_pipeline_runs SET phases = ${tx.json(runningPhases)}, updated_at = now()
      WHERE id = ${run.id}
    `;

    return { ok: true, run, runningPhases };
  });

  if (!claim.ok) {
    res.status(claim.status).json({ error: claim.error });
    return;
  }
  const { run, runningPhases } = claim;

  try {
    await dispatchPhase(phase, { ...run, phases: runningPhases });
  } catch (err) {
    // Mismo criterio que confirm.js: solo la fase queda failed, el run sigue
    // 'processing' (retry-able de nuevo). Transaccional con FOR UPDATE por si
    // el estado cambió entre el claim y este fallo de dispatch.
    await sql.begin(async (tx) => {
      const rows = await tx`SELECT phases FROM song_pipeline_runs WHERE id = ${run.id} FOR UPDATE`;
      if (rows.length === 0) return;
      const fresh = rows[0].phases;
      if (fresh[phase]?.status !== 'running') return;
      const failedPhases = structuredClone(fresh);
      failedPhases[phase] = { status: 'failed', error: String(err?.message ?? err).slice(0, 300) };
      await tx`
        UPDATE song_pipeline_runs SET phases = ${tx.json(failedPhases)}, updated_at = now()
        WHERE id = ${run.id}
      `;
    });
    const e = new Error('No se pudo reintentar la fase. Intenta de nuevo.');
    e.status = 502;
    throw e;
  }

  res.status(200).json({ success: true });
});
