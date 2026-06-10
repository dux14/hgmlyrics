import sql from '../../_lib/db.js';
import { requireUser } from '../../_lib/auth.js';
import { allowMethods, withErrors } from '../../_lib/http.js';

async function assertOwner(id, userId) {
  const owned = await sql`SELECT id FROM ephemeral_lists WHERE id = ${id} AND owner_id = ${userId}`;
  if (!owned[0]) {
    const e = new Error('No autorizado');
    e.status = 403;
    throw e;
  }
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['POST'])) return;
  const user = await requireUser(req);
  const id = req.query.id;
  await assertOwner(id, user.id);

  const username = (req.body?.username || '').trim();
  if (!username) {
    const e = new Error('username requerido');
    e.status = 400;
    throw e;
  }
  const found =
    await sql`SELECT id, username FROM profiles WHERE lower(username) = lower(${username})`;
  const target = found[0];
  if (!target) {
    const e = new Error('Usuario no encontrado');
    e.status = 404;
    throw e;
  }
  if (target.id === user.id) {
    const e = new Error('No puedes invitarte a ti mismo');
    e.status = 400;
    throw e;
  }

  await sql`INSERT INTO ephemeral_list_members (list_id, user_id)
            VALUES (${id}, ${target.id}) ON CONFLICT DO NOTHING`;
  res.status(201).json({ user_id: target.id, username: target.username });
});
