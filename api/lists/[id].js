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
      SELECT l.id, l.name, l.expires_at, l.owner_id, l.parent_id
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
    const children = await sql`
      SELECT c.id, c.name, c.expires_at,
             (SELECT count(*) FROM ephemeral_list_songs s WHERE s.list_id = c.id) AS song_count
      FROM ephemeral_lists c
      WHERE c.parent_id = ${id} AND c.expires_at > now()
      ORDER BY c.expires_at ASC
    `;
    let parent = null;
    if (list.parent_id) {
      const prows = await sql`
        SELECT id, name FROM ephemeral_lists WHERE id = ${list.parent_id}
      `;
      parent = prows[0] || null;
    }
    res.status(200).json({
      id: list.id,
      name: list.name,
      expires_at: list.expires_at,
      parent_id: list.parent_id,
      parent,
      children,
      role: list.owner_id === user.id ? 'owner' : 'member',
      songs: songs.map((s) => s.song_id),
      members,
    });
    return;
  }

  if (req.method === 'PATCH') {
    const current = (
      await sql`SELECT id, owner_id, parent_id, expires_at
                FROM ephemeral_lists WHERE id = ${id} AND owner_id = ${user.id}`
    )[0];
    if (!current) {
      const e = new Error('Lista no encontrada');
      e.status = 404;
      throw e;
    }

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
    if (req.body?.expires_at) {
      const next = validateExpiry(req.body.expires_at);
      if (current.parent_id) {
        const prow = (
          await sql`SELECT expires_at FROM ephemeral_lists WHERE id = ${current.parent_id}`
        )[0];
        if (prow && new Date(next) > new Date(prow.expires_at)) {
          const e = new Error('La sub-lista no puede caducar después del evento');
          e.status = 400;
          throw e;
        }
      } else {
        const mrow = (
          await sql`SELECT max(expires_at) AS m FROM ephemeral_lists
                    WHERE parent_id = ${id} AND expires_at > now()`
        )[0];
        if (mrow?.m && new Date(next) < new Date(mrow.m)) {
          const e = new Error('El evento no puede caducar antes que sus sub-listas');
          e.status = 400;
          throw e;
        }
      }
      fields.expires_at = next;
    }
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
