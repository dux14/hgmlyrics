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

  // Candidatos a expirar: succeeded/partial vencidos (expires_at) y jobs "colgados"
  // (running > 1h sin avanzar). NO se marcan todavía: primero hay que purgar su storage.
  const candidates = await sql`
    SELECT id, user_id FROM pitch_jobs
    WHERE (status IN ('succeeded', 'partial') AND expires_at IS NOT NULL AND expires_at < now())
       OR (status = 'running' AND updated_at < now() - interval '1 hour')
  `;
  // Perf: el borrado de Storage de cada job es independiente — Promise.allSettled evita
  // que un borrado fallido aborte el resto (y por ende el cron, maxDuration=60s).
  const purgeResults = await Promise.allSettled(
    candidates.map((job) => deletePitchPrefix(`${job.user_id}/${job.id}`)),
  );
  // Solo marcar 'expired' los jobs cuyo storage se borró de verdad. Si el borrado falla,
  // el job sigue en su estado y el próximo cron lo reintenta — evita storage huérfano
  // que un 'expired' (que nunca se revisita) dejaría para siempre.
  const purged = candidates.filter((_, i) => purgeResults[i].status === 'fulfilled');
  for (const job of purged) {
    await sql`
      UPDATE pitch_jobs SET status = 'expired', updated_at = now()
      WHERE id = ${job.id}
    `;
  }

  res.status(200).json({ expired: purged.length });
});
