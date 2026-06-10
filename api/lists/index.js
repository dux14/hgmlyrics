import sql from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { allowMethods, withErrors } from '../_lib/http.js';

const MAX_DAYS = 90;

function validateExpiry(value) {
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) {
    const e = new Error('Fecha de caducidad inválida');
    e.status = 400;
    throw e;
  }
  const now = Date.now();
  if (ts <= now) {
    const e = new Error('La caducidad debe ser futura');
    e.status = 400;
    throw e;
  }
  if (ts > now + MAX_DAYS * 86400000) {
    const e = new Error('Máximo 90 días');
    e.status = 400;
    throw e;
  }
  return new Date(ts).toISOString();
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET', 'POST'])) return;
  const user = await requireUser(req);

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT l.id, l.name, l.expires_at, l.owner_id,
             (l.owner_id = ${user.id}) AS is_owner,
             (SELECT count(*) FROM ephemeral_list_songs s WHERE s.list_id = l.id) AS song_count
      FROM ephemeral_lists l
      WHERE l.expires_at > now()
        AND (l.owner_id = ${user.id}
             OR EXISTS (SELECT 1 FROM ephemeral_list_members m
                        WHERE m.list_id = l.id AND m.user_id = ${user.id}))
      ORDER BY l.created_at DESC
    `;
    res.status(200).json({ lists: rows });
    return;
  }

  // POST
  const name = (req.body?.name || '').trim();
  if (!name || name.length > 80) {
    const e = new Error('Nombre inválido (1-80)');
    e.status = 400;
    throw e;
  }
  const expiresAt = validateExpiry(req.body?.expires_at);
  const rows = await sql`
    INSERT INTO ephemeral_lists (owner_id, name, expires_at)
    VALUES (${user.id}, ${name}, ${expiresAt})
    RETURNING id, name, expires_at
  `;
  res.status(201).json(rows[0]);
});
