import sql from '../_lib/db.js';
import { requireAdmin } from '../_lib/auth.js';
import { allowMethods, withErrors } from '../_lib/http.js';

// GET    → { flags: [{key, description, enabledGlobal, users:[{email,username}]}] }
// POST   → body { flagKey, email?, username? } agrega asignación
// DELETE → body { flagKey, email?, username? } quita asignación
async function list(_req, res) {
  const flags = await sql`
    SELECT key, description, enabled_global AS "enabledGlobal"
    FROM feature_flags ORDER BY key
  `;
  const users = await sql`
    SELECT flag_key AS "flagKey", email, username FROM feature_flag_users
  `;
  const byFlag = new Map(flags.map((f) => [f.key, { ...f, users: [] }]));
  for (const u of users)
    {byFlag.get(u.flagKey)?.users.push({ email: u.email, username: u.username });}
  res.status(200).json({ flags: [...byFlag.values()] });
}

async function addAssignment(req, res) {
  const { flagKey, email, username } = req.body ?? {};
  if (!flagKey || (!email && !username)) {
    res.status(400).json({ error: 'flagKey y (email o username) son requeridos' });
    return;
  }
  await sql`
    INSERT INTO feature_flag_users (flag_key, email, username)
    VALUES (${flagKey}, ${email ?? null}, ${username ?? null})
    ON CONFLICT DO NOTHING
  `;
  res.status(200).json({ success: true });
}

async function removeAssignment(req, res) {
  const { flagKey, email, username } = req.body ?? {};
  if (!flagKey || (!email && !username)) {
    res.status(400).json({ error: 'flagKey y (email o username) son requeridos' });
    return;
  }
  await sql`
    DELETE FROM feature_flag_users
    WHERE flag_key = ${flagKey}
      AND email IS NOT DISTINCT FROM ${email ?? null}
      AND username IS NOT DISTINCT FROM ${username ?? null}
  `;
  res.status(200).json({ success: true });
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET', 'POST', 'DELETE'])) return;
  await requireAdmin(req, sql);
  if (req.method === 'GET') return list(req, res);
  if (req.method === 'POST') return addAssignment(req, res);
  return removeAssignment(req, res);
});
