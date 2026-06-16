import sql from '../_lib/db.js';
import { requireAdmin } from '../_lib/auth.js';
import { allowMethods, withErrors } from '../_lib/http.js';

// GET → { users: [{ id, username, displayName }] }
async function listProfiles(_req, res) {
  const users = await sql`
    SELECT id, username, display_name AS "displayName"
    FROM profiles
    WHERE username IS NOT NULL
    ORDER BY lower(coalesce(display_name, username))
  `;
  res.status(200).json({ users });
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET'])) return;
  await requireAdmin(req, sql);
  return listProfiles(req, res);
});
