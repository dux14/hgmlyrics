import sql from '../_lib/db.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { timingSafeEqualStr } from '../_lib/crypto.js';
import { deletePitchPrefix } from './_lib/storage.js';

// Vercel cron manda Authorization: Bearer ${CRON_SECRET}
export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['POST', 'GET'])) return;
  const auth = req.headers?.authorization ?? '';
  const secret = process.env.CRON_SECRET;
  const expected = secret ? `Bearer ${secret}` : null;
  if (!expected || !timingSafeEqualStr(auth, expected)) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }

  // Expira: succeeded/partial vencidos (expires_at) y jobs "colgados"
  // (running > 1h sin avanzar), y borra el prefijo de storage de cada uno.
  const expired = await sql`
    UPDATE pitch_jobs SET status = 'expired', updated_at = now()
    WHERE (status IN ('succeeded', 'partial') AND expires_at IS NOT NULL AND expires_at < now())
       OR (status = 'running' AND updated_at < now() - interval '1 hour')
    RETURNING id, user_id
  `;
  await Promise.allSettled(expired.map((job) => deletePitchPrefix(`${job.user_id}/${job.id}`)));

  res.status(200).json({ expired: expired.length });
});
