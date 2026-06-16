// api/weekly-words/[id].js
import sql from '../_lib/db.js';
import { requireUser, requireAdmin } from '../_lib/auth.js';
import { allowMethods, withErrors } from '../_lib/http.js';

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET', 'PATCH', 'DELETE'])) return;
  const id = req.query.id;

  if (req.method === 'GET') {
    await requireUser(req);
    const rows = await sql`
      SELECT * FROM weekly_words WHERE id = ${id} AND published = true
    `;
    if (!rows[0]) {
      const e = new Error('Voz en off no encontrada');
      e.status = 404;
      throw e;
    }
    res.status(200).json(rows[0]);
    return;
  }

  // PATCH and DELETE — admin only
  await requireAdmin(req, sql);

  if (req.method === 'PATCH') {
    const b = req.body ?? {};
    const fields = {};
    if (typeof b.gospel_ref === 'string') fields.gospel_ref = b.gospel_ref.trim();
    if (typeof b.liturgical_title === 'string') fields.liturgical_title = b.liturgical_title;
    if (typeof b.liturgical_color === 'string') fields.liturgical_color = b.liturgical_color;
    if (typeof b.voiceover_body === 'string') fields.voiceover_body = b.voiceover_body;
    if (typeof b.gospel_body === 'string') fields.gospel_body = b.gospel_body;
    if (typeof b.published === 'boolean') fields.published = b.published;
    if (typeof b.sunday_date === 'string') fields.sunday_date = b.sunday_date;

    if (Object.keys(fields).length === 0) {
      const e = new Error('Nada que actualizar');
      e.status = 400;
      throw e;
    }
    const rows = await sql`
      UPDATE weekly_words SET ${sql(fields)}, updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;
    if (!rows[0]) {
      const e = new Error('Voz en off no encontrada');
      e.status = 404;
      throw e;
    }
    res.status(200).json(rows[0]);
    return;
  }

  // DELETE
  const rows = await sql`DELETE FROM weekly_words WHERE id = ${id} RETURNING id`;
  if (!rows[0]) {
    const e = new Error('Voz en off no encontrada');
    e.status = 404;
    throw e;
  }
  res.status(204).end?.() ?? res.status(204).json({});
});
