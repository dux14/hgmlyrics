import sql from './_lib/db.js';
import { allowMethods, withErrors } from './_lib/http.js';

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET'])) return;
  const rows =
    await sql`SELECT COALESCE(EXTRACT(EPOCH FROM MAX(updated_at)) * 1000, 0)::bigint AS data_version FROM songs`;
  // Postgres bigint comes back as a string from postgres.js; coerce to Number for JSON.
  const dataVersion = Number(rows[0].data_version);
  res.status(200).json({ dataVersion });
});
