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

  const rows = await sql`
    SELECT id, song_id AS "songId", status, phases, input_path AS "inputPath"
    FROM song_pipeline_runs
    WHERE song_id = ${songId}
      AND status IN ('created', 'uploading', 'processing', 'awaiting_lyrics', 'running')
    ORDER BY created_at DESC LIMIT 1
  `;
  if (rows.length === 0) {
    res.status(404).json({ error: 'No hay una ejecución activa para esta canción' });
    return;
  }
  const run = rows[0];

  const current = run.phases[phase]?.status;
  if (current !== 'failed' && current !== 'stale') {
    res.status(409).json({ error: `La fase '${phase}' no está en failed/stale (está en ${current})` });
    return;
  }

  // canStartPhase exige status pending|stale — 'failed' se resetea primero, y
  // recién sobre ese estado se valida el DAG (evita re-despachar sin las
  // dependencias listas).
  const pendingPhases = structuredClone(run.phases);
  pendingPhases[phase] = { status: 'pending', error: null, tracks: undefined, artifacts: undefined };
  if (!canStartPhase(pendingPhases, phase)) {
    res.status(409).json({ error: `Las dependencias de '${phase}' no están listas` });
    return;
  }

  const runningPhases = structuredClone(pendingPhases);
  runningPhases[phase].status = 'running';

  const claimed = await sql`
    UPDATE song_pipeline_runs SET phases = ${sql.json(runningPhases)}, updated_at = now()
    WHERE id = ${run.id}
  `;
  if (claimed.count === 0) {
    res.status(409).json({ error: 'La ejecución cambió de estado, recarga' });
    return;
  }

  try {
    await dispatchPhase(phase, { ...run, phases: runningPhases });
  } catch (err) {
    // Mismo criterio que confirm.js: solo la fase queda failed, el run sigue
    // 'processing' (retry-able de nuevo).
    const failedPhases = structuredClone(runningPhases);
    failedPhases[phase] = { status: 'failed', error: String(err?.message ?? err).slice(0, 300) };
    await sql`
      UPDATE song_pipeline_runs SET phases = ${sql.json(failedPhases)}, updated_at = now()
      WHERE id = ${run.id}
    `;
    const e = new Error('No se pudo reintentar la fase. Intenta de nuevo.');
    e.status = 502;
    throw e;
  }

  res.status(200).json({ success: true });
});
