import sql from '../_lib/db.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { verifyPitchSignature } from './_lib/hmac.js';
import { applyPhaseWebhook, REQUIRED_PHASES } from './_lib/process.js';

// Raw body necesario para verificar la firma HMAC (espeja api/stems/webhook.js).
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
  const ok = verifyPitchSignature({
    timestamp: req.headers['x-modal-timestamp'],
    signature: req.headers['x-modal-signature'],
    body,
    secret: process.env.PITCH_MODAL_WEBHOOK_SECRET,
  });
  if (!ok) {
    res.status(401).json({ error: 'Firma de webhook inválida' });
    return;
  }

  const { jobId, phase, result } = JSON.parse(body);

  if (!jobId || !phase) {
    res.status(400).json({ error: 'jobId/phase requeridos' });
    return;
  }
  if (!REQUIRED_PHASES.includes(phase)) {
    res.status(400).json({ error: `Fase inválida: ${phase}` });
    return;
  }

  const outcome = await applyPhaseWebhook(sql, jobId, phase, result ?? {});
  if (outcome === null) {
    res.status(404).json({ error: 'Job no encontrado' });
    return;
  }
  res.status(200).json({ status: outcome.status });
});
