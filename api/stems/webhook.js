import sql from '../_lib/db.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { verifyWebhookSignature } from '../_lib/replicate.js';
import { verifyModalSignature } from '../_lib/modal.js';
import { processPredictionResult, applySectionWebhook } from './_process.js';
import { SECTION_KEYS } from './_sections.js';

// Raw body necesario para verificar la firma; copia los WAV → puede tardar.
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

  // job, kind y provider viajan en la query del webhook URL (contrato legado)
  const url = new URL(req.url, 'http://local');
  const jobParam = req.query?.job ?? url.searchParams.get('job');
  const kind = req.query?.kind ?? url.searchParams.get('kind');
  const provider =
    (req.query?.provider ?? url.searchParams.get('provider')) === 'modal' ? 'modal' : 'replicate';

  const ok =
    provider === 'modal' || !jobParam
      ? verifyModalSignature({
          timestamp: req.headers['x-modal-timestamp'],
          signature: req.headers['x-modal-signature'],
          body,
          secret: process.env.MODAL_WEBHOOK_SECRET,
        })
      : verifyWebhookSignature({
          id: req.headers['webhook-id'],
          timestamp: req.headers['webhook-timestamp'],
          signatures: req.headers['webhook-signature'],
          body,
          secret: process.env.REPLICATE_WEBHOOK_SECRET,
        });
  if (!ok) {
    res.status(401).json({ error: 'Firma de webhook inválida' });
    return;
  }

  const payload = JSON.parse(body);

  // ── Nuevo contrato DAG per-sección: { jobId, section, result } ─────────────
  // El orquestador Modal postea este formato sin query params.
  if (payload.section !== undefined || (!jobParam && !kind)) {
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
    return;
  }

  // ── Contrato legado: { status, output } con job/kind en query ─────────────
  if (!jobParam || !['stems', 'karaoke', 'diarization'].includes(kind)) {
    res.status(400).json({ error: 'Parámetros job/kind inválidos' });
    return;
  }

  const rows = await sql`SELECT * FROM stem_jobs WHERE id = ${jobParam}`;
  if (rows.length === 0) {
    res.status(404).json({ error: 'Job no encontrado' });
    return;
  }

  await processPredictionResult(sql, rows[0], kind, payload, provider);
  res.status(200).json({ ok: true });
});
