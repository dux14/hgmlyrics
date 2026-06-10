import sql from '../../../_lib/db.js';
import { requireUser } from '../../../_lib/auth.js';
import { allowMethods, withErrors } from '../../../_lib/http.js';
import { signStemsDownload } from '../../../_lib/storage.js';
import { startModel, providerFor } from '../../_provider.js';
import { MODELS } from '../../_models.js';

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['POST'])) return;
  const user = await requireUser(req);
  const { id } = req.query;

  const rows = await sql`
    SELECT * FROM stem_jobs WHERE id = ${id} AND user_id = ${user.id}
  `;
  if (rows.length === 0) {
    res.status(404).json({ error: 'Job no encontrado' });
    return;
  }
  const job = rows[0];
  if (job.status !== 'created') {
    res.status(409).json({ error: `El job ya está en estado ${job.status}` });
    return;
  }

  // El archivo debe existir: si la signed URL no firma, no se subió.
  let audioUrl;
  try {
    audioUrl = await signStemsDownload(job.input_path, 3600);
  } catch {
    res.status(400).json({ error: 'El archivo no terminó de subirse. Intenta de nuevo.' });
    return;
  }

  const base =
    process.env.PUBLIC_BASE_URL ?? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  const suffix = providerFor('stems') === 'modal' ? '&provider=modal' : '';
  const prediction = await startModel({
    kind: 'stems',
    input: MODELS.stems.buildInput(audioUrl),
    jobId: job.id,
    userId: user.id,
    callbackUrl: `${base}/api/stems/webhook?job=${job.id}&kind=stems${suffix}`,
  });

  await sql`
    UPDATE stem_jobs SET status = 'separating_stems',
      predictions = predictions || ${sql.json({ stems: prediction.id })},
      updated_at = now()
    WHERE id = ${job.id} AND status = 'created'
  `;
  res.status(200).json({ ok: true });
});
