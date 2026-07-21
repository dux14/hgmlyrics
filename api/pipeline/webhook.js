// webhook.js — Webhook unificado por fase del pipeline DAG (spec Task B3).
// Mismo contrato de firma que api/stems/webhook.js: body crudo + HMAC de
// api/_lib/modal.js contra MODAL_WEBHOOK_SECRET. Un solo endpoint recibe los
// callbacks de todas las apps Modal del pipeline (stems/transcription/
// sync/pitch/clips), identificadas por { runId, phase } en el body.
import sql from '../_lib/db.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { verifyModalSignature } from '../_lib/modal.js';
import { PHASES, canStartPhase } from '../_lib/pipeline/state.js';
import { applyPipelinePhaseEvent } from '../_lib/pipeline/process.js';
import { dispatchPhase } from '../songs/[id]/pipeline/_dispatch.js';

// Raw body necesario para verificar la firma HMAC.
export const config = {
  api: { bodyParser: false },
  maxDuration: 300,
};

// Fase que se dispara automáticamente al completarse la fase clave (DAG
// lineal de esta etapa). sync→clips y stems→transcription son las únicas
// transiciones automáticas; lyrics_review/sync/pitch se disparan desde otros
// endpoints (aprobación de letra), fuera del alcance de este webhook.
const ADVANCE_AFTER = { stems: 'transcription', sync: 'clips' };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Dispara la fase siguiente tras un commit exitoso. Aislado en try/catch: un
// fallo de dispatch no debe romper la respuesta 200 del webhook (mismo
// criterio que confirm.js/retry.js) — solo la fase que se intentó arrancar
// queda 'failed' y admite reintento manual vía retry.js.
async function advanceNextPhase(run, phase) {
  const runningPhases = structuredClone(run.phases);
  runningPhases[phase] = { ...runningPhases[phase], status: 'running' };
  await sql`
    UPDATE song_pipeline_runs SET phases = ${sql.json(runningPhases)}, updated_at = now()
    WHERE id = ${run.id}
  `;
  try {
    await dispatchPhase(phase, { ...run, phases: runningPhases });
  } catch (err) {
    const failedPhases = structuredClone(runningPhases);
    failedPhases[phase] = { status: 'failed', error: String(err?.message ?? err).slice(0, 300) };
    await sql`
      UPDATE song_pipeline_runs SET phases = ${sql.json(failedPhases)}, updated_at = now()
      WHERE id = ${run.id}
    `;
  }
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['POST'])) return;

  const body = await readRawBody(req);
  const okSignature = verifyModalSignature({
    timestamp: req.headers['x-modal-timestamp'],
    signature: req.headers['x-modal-signature'],
    body,
    secret: process.env.MODAL_WEBHOOK_SECRET,
  });
  if (!okSignature) {
    res.status(401).json({ error: 'Firma de webhook inválida' });
    return;
  }

  const event = JSON.parse(body);
  const { runId, phase } = event;
  if (!runId || !phase) {
    res.status(400).json({ error: 'Parámetros runId/phase requeridos' });
    return;
  }
  if (!PHASES.includes(phase)) {
    res.status(400).json({ error: `Fase inválida: ${phase}` });
    return;
  }

  const outcome = await applyPipelinePhaseEvent(sql, runId, event);
  if (outcome === null) {
    res.status(404).json({ error: 'Ejecución no encontrada' });
    return;
  }
  if (outcome.ignored) {
    res.status(200).json({ ignored: true });
    return;
  }
  if (outcome.stale) {
    res.status(200).json({ stale: true });
    return;
  }

  const advance = ADVANCE_AFTER[phase];
  if (advance && canStartPhase(outcome.next, advance)) {
    // Fuera de la transacción del CAS: el commit de `phases` ya está firme.
    try {
      await advanceNextPhase({ id: runId, songId: outcome.songId, phases: outcome.next }, advance);
    } catch {
      // advanceNextPhase ya captura sus propios errores de dispatch; este
      // catch es solo un cinturón extra para nunca romper el 200 del webhook.
    }
  }

  res.status(200).json({ status: outcome.status });
});

export { applyPipelinePhaseEvent };
