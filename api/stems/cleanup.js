import sql from '../_lib/db.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { deleteStemsPrefix } from '../_lib/storage.js';

// Vercel cron manda Authorization: Bearer ${CRON_SECRET}
export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET'])) return;
  const auth = req.headers?.authorization ?? '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }

  // 1) Expirar resultados > 48h: borrar archivos y limpiar paths
  const expired = await sql`
    SELECT id, user_id FROM stem_jobs
    WHERE status = 'done' AND expires_at < now()
  `;
  for (const job of expired) {
    await deleteStemsPrefix(`${job.user_id}/${job.id}`);
    await sql`
      UPDATE stem_jobs SET status = 'expired', stems = NULL, voices = NULL,
        input_path = NULL, updated_at = now()
      WHERE id = ${job.id}
    `;
  }

  // 2) Jobs zombi: en proceso > 30 min → failed (no consume cuota)
  const zombies = await sql`
    UPDATE stem_jobs SET status = 'failed',
      error = 'El procesamiento tardó demasiado y fue cancelado. Intenta de nuevo.',
      updated_at = now()
    WHERE status IN ('separating_stems', 'separating_voices')
      AND updated_at < now() - interval '30 minutes'
    RETURNING id, user_id
  `;
  for (const job of zombies) {
    await deleteStemsPrefix(`${job.user_id}/${job.id}`);
  }

  // 3) Uploads abandonados: created/uploaded > 24h → failed + limpiar
  const abandoned = await sql`
    UPDATE stem_jobs SET status = 'failed', error = 'Subida abandonada', updated_at = now()
    WHERE status IN ('created', 'uploaded') AND created_at < now() - interval '24 hours'
    RETURNING id, user_id
  `;
  for (const job of abandoned) {
    await deleteStemsPrefix(`${job.user_id}/${job.id}`);
  }

  res
    .status(200)
    .json({ expired: expired.length, zombies: zombies.length, abandoned: abandoned.length });
});
