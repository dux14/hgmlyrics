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

// Dispara la fase siguiente tras un commit exitoso. CAS transaccional: el
// claim (leer `phases` FRESCO + validar canStartPhase + marcar 'running') va
// en una sola tx con FOR UPDATE para no pisar un commit concurrente de otra
// fase (pitch/sync corren en paralelo) — el UPDATE ciego anterior sobrescribía
// todo el jsonb con un snapshot viejo (lost update). El dispatch va FUERA de
// la tx (llamada de red); un fallo de dispatch no debe romper la respuesta
// 200 del webhook (mismo criterio que confirm.js/retry.js) — solo la fase que
// se intentó arrancar queda 'failed' y admite reintento manual vía retry.js.
async function advanceNextPhase(runId, songId, phase) {
  const claimed = await sql.begin(async (tx) => {
    const rows = await tx`SELECT phases FROM song_pipeline_runs WHERE id = ${runId} FOR UPDATE`;
    if (rows.length === 0) return null;
    const fresh = rows[0].phases;
    if (!canStartPhase(fresh, phase)) return null;
    const next = structuredClone(fresh);
    next[phase] = { ...next[phase], status: 'running' };
    await tx`
      UPDATE song_pipeline_runs SET phases = ${tx.json(next)}, updated_at = now()
      WHERE id = ${runId}
    `;
    return next;
  });
  if (!claimed) return;

  try {
    await dispatchPhase(phase, { id: runId, songId, phases: claimed });
  } catch (err) {
    await sql.begin(async (tx) => {
      const rows = await tx`SELECT phases FROM song_pipeline_runs WHERE id = ${runId} FOR UPDATE`;
      if (rows.length === 0) return;
      const fresh = rows[0].phases;
      if (fresh[phase]?.status !== 'running') return;
      const failed = structuredClone(fresh);
      failed[phase] = { status: 'failed', error: String(err?.message ?? err).slice(0, 300) };
      await tx`
        UPDATE song_pipeline_runs SET phases = ${tx.json(failed)}, updated_at = now()
        WHERE id = ${runId}
      `;
    });
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

  let event;
  try {
    event = JSON.parse(body);
  } catch {
    res.status(400).json({ error: 'Body JSON inválido' });
    return;
  }
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
      await advanceNextPhase(runId, outcome.songId, advance);
    } catch (err) {
      // advanceNextPhase ya captura sus propios errores de dispatch; este
      // catch es solo un cinturón extra para nunca romper el 200 del webhook.
      console.error('advanceNextPhase falló:', err);
    }
  }

  res.status(200).json({ status: outcome.status });
});

export { applyPipelinePhaseEvent };
