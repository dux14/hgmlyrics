// api/weekly-words/index.js
import sql from '../_lib/db.js';
import { requireUser, requireAdmin } from '../_lib/auth.js';
import { allowMethods, withErrors } from '../_lib/http.js';

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET', 'POST'])) return;

  if (req.method === 'GET') {
    await requireUser(req);
    const rows = await sql`
      SELECT id, sunday_date, gospel_ref, liturgical_title, liturgical_color, published, created_at
      FROM weekly_words
      WHERE published = true
      ORDER BY sunday_date DESC
    `;
    res.status(200).json({ weeklyWords: rows });
    return;
  }

  // POST — admin only
  await requireAdmin(req, sql);
  const b = req.body ?? {};
  const sunday_date = b.sunday_date;
  const gospel_ref = (b.gospel_ref ?? '').trim();
  const voiceover_body = (b.voiceover_body ?? '').trim();

  if (!sunday_date || !/^\d{4}-\d{2}-\d{2}$/.test(sunday_date)) {
    const e = new Error('sunday_date requerido (YYYY-MM-DD)');
    e.status = 400;
    throw e;
  }
  if (!gospel_ref) {
    const e = new Error('gospel_ref requerido');
    e.status = 400;
    throw e;
  }
  if (!voiceover_body) {
    const e = new Error('voiceover_body requerido');
    e.status = 400;
    throw e;
  }

  let rows;
  try {
    rows = await sql`
      INSERT INTO weekly_words
        (sunday_date, gospel_ref, liturgical_title, liturgical_color, voiceover_body, gospel_body, published)
      VALUES
        (${sunday_date}, ${gospel_ref}, ${b.liturgical_title ?? null},
         ${b.liturgical_color ?? null}, ${voiceover_body}, ${b.gospel_body ?? null}, ${b.published === true})
      RETURNING *
    `;
  } catch (err) {
    // 23505 = unique_violation: ya hay una voz en off para ese domingo.
    if (err?.code === '23505') {
      const e = new Error('Ya existe una voz en off para ese domingo. Edítala desde el archivo.');
      e.status = 409;
      throw e;
    }
    throw err;
  }
  res.status(201).json(rows[0]);
});
