import sql from '../../_lib/db.js';
import { requireUser } from '../../_lib/auth.js';
import { allowMethods, withErrors } from '../../_lib/http.js';
import { signStemsDownload } from '../../_lib/storage.js';

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

  // Modal es fire-and-forget: si el job lleva >10 min en processing sin avanzar, marcar failed.
  if (job.status === 'processing') {
    const elapsed = Date.now() - new Date(job.updated_at).getTime();
    if (elapsed > MODAL_TIMEOUT_MS) {
      await sql`
        UPDATE stem_jobs SET status = 'failed',
          error = 'El procesamiento expiró. Intenta de nuevo (no consumió tu cuota).', updated_at = now()
        WHERE id = ${job.id} AND status = 'processing'
      `;
      rows = await sql`SELECT * FROM stem_jobs WHERE id = ${id} AND user_id = ${user.id}`;
      job = rows[0];
    }
  }

  res.status(200).json({ job: job.status === 'done' ? await withSignedUrls(job) : job });
});
