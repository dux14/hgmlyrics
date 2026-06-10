import sql from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { allowMethods, withErrors } from '../_lib/http.js';

const MAX_DAYS = 90;
function validateExpiry(value) {
  const ts = Date.parse(value);
  if (Number.isNaN(ts) || ts <= Date.now() || ts > Date.now() + MAX_DAYS * 86400000) {
    const e = new Error('Caducidad inválida (futura, ≤90 días)');
    e.status = 400;
    throw e;
  }
  return new Date(ts).toISOString();
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET', 'PATCH', 'DELETE'])) return;
  const user = await requireUser(req);
  const id = req.query.id;

  if (req.method === 'GET') {
    const lists = await sql`
      SELECT l.id, l.name, l.expires_at, l.owner_id
      FROM ephemeral_lists l
      WHERE l.id = ${id} AND l.expires_at > now()
        AND (l.owner_id = ${user.id}
             OR EXISTS (SELECT 1 FROM ephemeral_list_members m
                        WHERE m.list_id = l.id AND m.user_id = ${user.id}))
    `;
    const list = lists[0];
    if (!list) {
      const e = new Error('Lista no encontrada');
      e.status = 404;
      throw e;
    }
    const songs = await sql`
      SELECT song_id, position FROM ephemeral_list_songs
      WHERE list_id = ${id} ORDER BY position ASC
    `;
    const members = await sql`
      SELECT m.user_id, p.username FROM ephemeral_list_members m
      JOIN profiles p ON p.id = m.user_id WHERE m.list_id = ${id}
    `;
    res.status(200).json({
      id: list.id,
      name: list.name,
      expires_at: list.expires_at,
      role: list.owner_id === user.id ? 'owner' : 'member',
      songIds: songs.map((s) => s.song_id),
      members,
    });
    return;
  }

  if (req.method === 'PATCH') {
    const fields = {};
    if (typeof req.body?.name === 'string') {
      const name = req.body.name.trim();
      if (!name || name.length > 80) {
        const e = new Error('Nombre inválido');
        e.status = 400;
        throw e;
      }
      fields.name = name;
    }
    if (req.body?.expires_at) fields.expires_at = validateExpiry(req.body.expires_at);
    if (Object.keys(fields).length === 0) {
      const e = new Error('Nada que actualizar');
      e.status = 400;
      throw e;
    }
    const rows = await sql`
      UPDATE ephemeral_lists SET ${sql(fields)}, updated_at = now()
      WHERE id = ${id} AND owner_id = ${user.id}
      RETURNING id, name, expires_at
    `;
    if (!rows[0]) {
      const e = new Error('Lista no encontrada');
      e.status = 404;
      throw e;
    }
    res.status(200).json(rows[0]);
    return;
  }

  // DELETE
  const rows =
    await sql`DELETE FROM ephemeral_lists WHERE id = ${id} AND owner_id = ${user.id} RETURNING id`;
  if (!rows[0]) {
    const e = new Error('Lista no encontrada');
    e.status = 404;
    throw e;
  }
  res.status(204).end?.() ?? res.status(204).json({});
});
