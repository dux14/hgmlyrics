// advance.js — Avance automático de fase del pipeline unificado, compartido
// entre api/pipeline/webhook.js (la mayoría de fases) y api/align/webhook.js
// (el legacy de alignment, único canal por el que completa la fase `sync`,
// ver notifyPipelineSync). Extraído para que ambos webhooks reusen el mismo
// CAS transaccional en vez de duplicar la lógica (y quedar desincronizados).
import { canStartPhase } from './state.js';
import { dispatchPhase } from '../../songs/[id]/pipeline/_dispatch.js';

// Fase que se dispara automáticamente al completarse la fase clave (DAG
// lineal de esta etapa). sync→clips y stems→transcription son las únicas
// transiciones automáticas; lyrics_review/sync/pitch se disparan desde otros
// endpoints (aprobación de letra), fuera del alcance de este módulo.
export const ADVANCE_AFTER = { stems: 'transcription', sync: 'clips' };

// Dispara la fase siguiente tras un commit exitoso. CAS transaccional: el
// claim (leer `phases` FRESCO + validar canStartPhase + marcar 'running') va
// en una sola tx con FOR UPDATE para no pisar un commit concurrente de otra
// fase (pitch/sync corren en paralelo) — el UPDATE ciego anterior sobrescribía
// todo el jsonb con un snapshot viejo (lost update). El dispatch va FUERA de
// la tx (llamada de red); un fallo de dispatch no debe romper la respuesta
// 200 del webhook (mismo criterio que confirm.js/retry.js) — solo la fase que
// se intentó arrancar queda 'failed' y admite reintento manual vía retry.js.
export async function advanceNextPhase(sql, runId, songId, phase) {
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
      failed[phase] = { status: 'failed', error: String(err?.message ?? err).slice(0, 300), retries: fresh[phase]?.retries || 0 };
      await tx`
        UPDATE song_pipeline_runs SET phases = ${tx.json(failed)}, updated_at = now()
        WHERE id = ${runId}
      `;
    });
  }
}
