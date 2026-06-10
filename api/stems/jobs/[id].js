import sql from '../../_lib/db.js';
import { requireUser } from '../../_lib/auth.js';
import { allowMethods, withErrors } from '../../_lib/http.js';
import { signStemsDownload } from '../../_lib/storage.js';
import { getPrediction } from '../../_lib/replicate.js';
import { processPredictionResult } from '../_process.js';
import { providerFor } from '../_provider.js';

const STALE_MS = 3 * 60 * 1000;
const MODAL_TIMEOUT_MS = 10 * 60 * 1000;

/** Convierte paths de storage a signed URLs de descarga para la respuesta. */
async function withSignedUrls(job) {
  const sign = async (obj) => {
    if (!obj) return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = typeof v === 'string' && v.includes('/') ? await signStemsDownload(v) : v;
    }
    return out;
  };
  return { ...job, stems: await sign(job.stems), voices: await sign(job.voices) };
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET'])) return;
  const user = await requireUser(req);
  const { id } = req.query;

  let rows = await sql`SELECT * FROM stem_jobs WHERE id = ${id} AND user_id = ${user.id}`;
  if (rows.length === 0) {
    res.status(404).json({ error: 'Job no encontrado' });
    return;
  }
  let job = rows[0];

  // Reconciliación: si está en proceso y sin avance > 3 min, consultar Replicate directo
  const inProgress = ['separating_stems', 'separating_voices'].includes(job.status);
  const stale = Date.now() - new Date(job.updated_at).getTime() > STALE_MS;
  const activeKinds = job.status === 'separating_stems' ? ['stems'] : ['karaoke', 'diarization'];
  const anyModal = activeKinds.some((k) => providerFor(k) === 'modal');

  if (inProgress && anyModal && Date.now() - new Date(job.updated_at).getTime() > MODAL_TIMEOUT_MS) {
    // Modal es fire-and-forget: si lleva >10 min sin avanzar, marcar como fallido
    await sql`
      UPDATE stem_jobs SET status = 'failed',
        error = 'El procesamiento expiró. Intenta de nuevo (no consumió tu cuota).', updated_at = now()
      WHERE id = ${job.id} AND status = ${job.status}
    `;
    rows = await sql`SELECT * FROM stem_jobs WHERE id = ${id} AND user_id = ${user.id}`;
    job = rows[0];
  } else if (inProgress && stale && job.predictions && !anyModal) {
    const kinds = activeKinds;
    for (const kind of kinds) {
      const predId = job.predictions[kind];
      if (!predId) continue;
      const prediction = await getPrediction(predId);
      if (['succeeded', 'failed', 'canceled'].includes(prediction.status)) {
        await processPredictionResult(sql, job, kind, prediction);
        rows = await sql`SELECT * FROM stem_jobs WHERE id = ${id} AND user_id = ${user.id}`;
        job = rows[0];
      }
    }
  }

  res.status(200).json({ job: job.status === 'done' ? await withSignedUrls(job) : job });
});
