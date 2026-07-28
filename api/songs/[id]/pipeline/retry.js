// Reintenta una fase failed/stale del run activo (spec Task B2): valida
// dependencias con canStartPhase, resetea la fase a pending/running y
// re-despacha. NO reintenta internamente (a diferencia de confirm.js): este
// endpoint ES el reintento explícito que pide el admin.
// El núcleo (claim transaccional + dispatch + bloque de fallo) vive en
// api/_lib/pipeline/retryPhase.js (Tarea 3, Entrega 2): lo comparte con el
// reintento automático (`auto:true`), que debe pasar por el mismo claim y el
// mismo canStartPhase para no reabrir el loop infinito con una fase 'stale'.
import sql from '../../../_lib/db.js';
import { requireAdmin } from '../../../_lib/auth.js';
import { allowMethods, withErrors } from '../../../_lib/http.js';
import { retryPhase } from '../../../_lib/pipeline/retryPhase.js';

const RETRYABLE_PHASES = new Set(['stems', 'structure', 'transcription', 'sync', 'pitch', 'clips']);

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

  const result = await retryPhase(sql, { songId, phase, auto: false });
  if (!result.ok) {
    // withErrors mapea status<500 a {error: e.message} tal cual, y status>=500
    // a {error:'Internal error'} (comportamiento previo del throw manual del
    // caso 502 de dispatch: el mensaje detallado solo se loguea server-side).
    const err = new Error(result.error);
    err.status = result.status;
    throw err;
  }

  res.status(200).json({ success: true });
});
