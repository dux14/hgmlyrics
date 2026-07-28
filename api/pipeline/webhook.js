// webhook.js — Webhook unificado por fase del pipeline DAG (spec Task B3).
// Mismo contrato de firma que api/stems/webhook.js: body crudo + HMAC de
// api/_lib/modal.js contra MODAL_WEBHOOK_SECRET. Un solo endpoint recibe los
// callbacks de todas las apps Modal del pipeline (stems/transcription/
// sync/pitch/clips), identificadas por { runId, phase } en el body.
//
// La app hkn-stems (reusada por la fase 'stems', ver dispatchStems) postea en
// cambio por SECCIÓN ({ jobId, section, result }, ver post_webhook en
// modal/sections/_common.py) — no conoce el concepto de fase del pipeline
// unificado. El adapter de abajo traduce ese shape al phase-event de 'stems'
// y sigue por el mismo camino que el resto de fases.
import sql from '../_lib/db.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { verifyModalSignature } from '../_lib/modal.js';
import { PHASES, canStartPhase } from '../_lib/pipeline/state.js';
import { applyPipelinePhaseEvent } from '../_lib/pipeline/process.js';
import { sectionEventToPhaseEvent } from '../_lib/pipeline/stemsAdapter.js';
import { ADVANCE_AFTER, advanceNextPhase } from '../_lib/pipeline/advance.js';
import { SECTION_KEYS } from '../stems/_sections.js';

// Raw body necesario para verificar la firma HMAC.
export const config = {
  api: { bodyParser: false },
  maxDuration: 300,
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['POST'])) return;

  const body = await readRawBody(req);

  let event;
  try {
    event = JSON.parse(body);
  } catch {
    res.status(400).json({ error: 'Body JSON inválido' });
    return;
  }

  // hkn-pitch firma con su propio secreto (PITCH_MODAL_WEBHOOK_SECRET, ver
  // modal/pitch/_common.py); el resto de fases (stems/align/transcription/
  // clips/structure) firma con MODAL_WEBHOOK_SECRET. El secreto se elige por
  // la fase del evento ANTES de verificar la firma: aceptar cualquiera de los
  // dos para cualquier fase (como antes) permitía que quien solo tuviera el
  // secreto de pitch emitiera eventos de stems/clips/structure. La fase de
  // sección de stems (evento sin `phase`, ver adapter abajo) siempre usa
  // MODAL_WEBHOOK_SECRET.
  const secret = event.phase === 'pitch'
    ? process.env.PITCH_MODAL_WEBHOOK_SECRET
    : process.env.MODAL_WEBHOOK_SECRET;
  const okSignature = Boolean(secret) && verifyModalSignature({
    timestamp: req.headers['x-modal-timestamp'],
    signature: req.headers['x-modal-signature'],
    body,
    secret,
  });
  if (!okSignature) {
    res.status(401).json({ error: 'Firma de webhook inválida' });
    return;
  }

  let phaseEvent;
  if (event.phase) {
    // Camino de fase (transcription/sync/pitch/clips postean así, y también
    // lo produce el adapter de sección de abajo).
    const { runId, phase } = event;
    if (!runId || !phase) {
      res.status(400).json({ error: 'Parámetros runId/phase requeridos' });
      return;
    }
    if (!PHASES.includes(phase)) {
      res.status(400).json({ error: `Fase inválida: ${phase}` });
      return;
    }
    phaseEvent = event;
  } else {
    // Camino de sección de stems (hkn-stems no conoce fases, ver nota arriba).
    const { jobId, section } = event;
    if (!jobId || !section) {
      res.status(400).json({ error: 'Parámetros jobId/section requeridos' });
      return;
    }
    if (!SECTION_KEYS.includes(section)) {
      res.status(400).json({ error: `Sección inválida: ${section}` });
      return;
    }
    const translated = sectionEventToPhaseEvent(event);
    if (translated === null) {
      // Sección no finalizadora (voiceInstrumental/gender/structure) que
      // falló: no es crítica para el DAG, se ignora sin tocar el run.
      res.status(200).json({ ignored: true });
      return;
    }
    phaseEvent = translated;
  }

  const { runId, phase } = phaseEvent;
  const outcome = await applyPipelinePhaseEvent(sql, runId, phaseEvent);
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
      await advanceNextPhase(sql, runId, outcome.songId, advance);
    } catch (err) {
      // advanceNextPhase ya captura sus propios errores de dispatch; este
      // catch es solo un cinturón extra para nunca romper el 200 del webhook.
      console.error('advanceNextPhase falló:', err);
    }
  }

  res.status(200).json({ status: outcome.status });
});

export { applyPipelinePhaseEvent };
