import sql from '../../_lib/db.js';
import { requireAdmin } from '../../_lib/auth.js';
import { allowMethods, withErrors } from '../../_lib/http.js';
import { dispatchAlign } from '../../_lib/align.js';

// POST: realineado manual admin. dispatchAlign es idempotente en 'processing'
// (no-op); en failed/stale/ready/pending re-dispara sin logica extra aqui.
export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['POST'])) return;
  await requireAdmin(req, sql);

  const songId = req.query.id;
  if (!songId || typeof songId !== 'string') {
    res.status(400).json({ error: 'id is required' });
    return;
  }

  await dispatchAlign(songId);
  res.status(200).json({ success: true });
});
