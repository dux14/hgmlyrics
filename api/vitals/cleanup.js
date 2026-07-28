import sql from '../_lib/db.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { timingSafeEqualStr } from '../_lib/crypto.js';

// Vercel cron manda Authorization: Bearer ${CRON_SECRET}. Purga filas viejas de
// web_vitals (endpoint sin auth, ver api/vitals.js): sin este cron, un cliente
// descontrolado o malicioso puede acumular filas indefinidamente incluso con
// el tope de tamaño por fila ya vigente en validateVital.
export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET'])) return;
  const auth = req.headers?.authorization ?? '';
  const secret = process.env.CRON_SECRET;
  const expected = secret ? `Bearer ${secret}` : null;
  if (!expected || !timingSafeEqualStr(auth, expected)) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }

  const deleted = await sql`
    DELETE FROM web_vitals WHERE created_at < now() - interval '30 days' RETURNING id
  `;

  res.status(200).json({ deleted: deleted.length });
});
