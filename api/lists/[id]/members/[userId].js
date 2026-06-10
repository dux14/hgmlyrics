import sql from '../../../_lib/db.js';
import { requireUser } from '../../../_lib/auth.js';
import { allowMethods, withErrors } from '../../../_lib/http.js';

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['DELETE'])) return;
  const user = await requireUser(req);
  const { id, userId } = req.query;
  const owned =
    await sql`SELECT id FROM ephemeral_lists WHERE id = ${id} AND owner_id = ${user.id}`;
  if (!owned[0]) {
    const e = new Error('No autorizado');
    e.status = 403;
    throw e;
  }
  await sql`DELETE FROM ephemeral_list_members WHERE list_id = ${id} AND user_id = ${userId}`;
  res.status(204).end?.() ?? res.status(204).json({});
});
