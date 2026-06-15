import { createHash } from 'node:crypto';
import sql from './_lib/db.js';
import { allowMethods, withErrors } from './_lib/http.js';

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET'])) return;
  const rows =
    await sql`SELECT COALESCE(EXTRACT(EPOCH FROM MAX(updated_at)) * 1000, 0)::bigint AS data_version FROM songs`;
  // Hash the raw epoch so the client can detect changes via inequality (=== / !==)
  // without exposing the actual write timestamp.
  const raw = rows[0].data_version; // postgres.js returns bigint as string
  const dataVersion = createHash('sha1').update(String(raw)).digest('hex').slice(0, 16);
  res.status(200).json({ dataVersion });
});
