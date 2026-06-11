import sql from '../_lib/db.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { verifyModalSignature } from '../_lib/modal.js';
import { applySectionWebhook } from './_process.js';
import { SECTION_KEYS } from './_sections.js';

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

  // Toda la firma va por Modal HMAC (DAG-only desde Task 0.7).
  const ok = verifyModalSignature({
    timestamp: req.headers['x-modal-timestamp'],
    signature: req.headers['x-modal-signature'],
    body,
    secret: process.env.MODAL_WEBHOOK_SECRET,
  });
  if (!ok) {
    res.status(401).json({ error: 'Firma de webhook inválida' });
    return;
  }

  const payload = JSON.parse(body);

  // Contrato DAG per-sección: { jobId, section, result }
  const { jobId, section, result } = payload;

  if (!jobId || !section) {
    res.status(400).json({ error: 'Parámetros jobId/section requeridos' });
    return;
  }
  if (!SECTION_KEYS.includes(section)) {
    res.status(400).json({ error: `Sección inválida: ${section}` });
    return;
  }

  const outcome = await applySectionWebhook(sql, jobId, section, result ?? {});
  if (outcome === null) {
    res.status(404).json({ error: 'Job no encontrado' });
    return;
  }
  res.status(200).json({ status: outcome.status });
});
