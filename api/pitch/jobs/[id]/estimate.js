import sql from '../../../_lib/db.js';
import { requireUser } from '../../../_lib/auth.js';
import { allowMethods, withErrors } from '../../../_lib/http.js';
import { estimate } from '../../_lib/pricing.js';

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['POST'])) return;
  const user = await requireUser(req);
  const { id } = req.query;
  const durationSec = Number(req.body?.durationSec);
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    res.status(400).json({ error: 'durationSec inválido' });
    return;
  }
  const rows =
    await sql`SELECT id, user_id, status, profile FROM pitch_jobs WHERE id = ${id} AND user_id = ${user.id}`;
  if (rows.length === 0) {
    res.status(404).json({ error: 'Job no encontrado' });
    return;
  }
  const job = rows[0];
  if (!['created', 'uploaded', 'estimating'].includes(job.status)) {
    res.status(409).json({ error: `No se puede estimar en estado ${job.status}` });
    return;
  }
  const est = estimate(job.profile, durationSec);
  await sql`
    UPDATE pitch_jobs
    SET status = 'awaiting_approval', duration_sec = ${durationSec},
        cost_estimate_lo = ${est.lo}, cost_estimate_hi = ${est.hi}, updated_at = now()
    WHERE id = ${id}`;
  res.status(200).json({ status: 'awaiting_approval', estimate: est });
});
