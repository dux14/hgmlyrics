import sql from '../../../_lib/db.js';
import { requireUser } from '../../../_lib/auth.js';
import { allowMethods, withErrors } from '../../../_lib/http.js';
import { canTransition } from '../../_lib/state.js';
import { deletePitchPrefix } from '../../_lib/storage.js';

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['POST'])) return;
  const user = await requireUser(req);
  const { id } = req.query;

  const rows = await sql`SELECT id, status FROM pitch_jobs WHERE id = ${id} AND user_id = ${user.id}`;
  if (rows.length === 0) {
    res.status(404).json({ error: 'Job no encontrado' });
    return;
  }
  const current = rows[0].status;
  if (!canTransition(current, 'cancelled')) {
    res.status(409).json({ error: `No se puede cancelar en estado ${current}` });
    return;
  }

  // Compare-and-swap sobre el estado observado: no pisar una transición concurrente
  // (p.ej. cancelar un job que justo pasó a succeeded/failed en otra request).
  const upd = await sql`
    UPDATE pitch_jobs SET status = 'cancelled', updated_at = now()
    WHERE id = ${id} AND status = ${current}`;
  if (upd.count !== 1) {
    res.status(409).json({ error: 'El job cambió de estado; vuelve a intentar' });
    return;
  }
  await deletePitchPrefix(`${user.id}/${id}`).catch(() => {}); // #3: liberar storage al cancelar
  res.status(200).json({ status: 'cancelled' });
});
