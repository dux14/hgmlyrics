import sql from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { createStemsUploadUrl } from '../_lib/storage.js';
import { ACTIVE_STATUSES, DAILY_QUOTA, validateUploadMeta } from '../_lib/stems.js';

async function quotaUsedToday(userId) {
  const rows = await sql`
    SELECT count(*)::int AS n FROM stem_jobs
    WHERE user_id = ${userId} AND status <> 'failed'
      AND created_at >= date_trunc('day', now())
  `;
  return rows[0]?.n ?? 0;
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['POST', 'GET'])) return;
  const user = await requireUser(req);

  if (req.method === 'GET') {
    const jobs = await sql`
      SELECT id, status, input_meta, stems, voices, error, created_at, expires_at
      FROM stem_jobs
      WHERE user_id = ${user.id} AND status <> 'expired'
        AND created_at > now() - interval '3 days'
      ORDER BY created_at DESC
    `;
    const used = await quotaUsedToday(user.id);
    res.status(200).json({ jobs, quota: { used, limit: DAILY_QUOTA } });
    return;
  }

  // POST: crear job
  const active = await sql`
    SELECT id FROM stem_jobs
    WHERE user_id = ${user.id} AND status IN ${sql(ACTIVE_STATUSES)}
    LIMIT 1
  `;
  if (active.length > 0) {
    const e = new Error('Ya tienes una canción en proceso. Espera a que termine.');
    e.status = 409;
    throw e;
  }

  const used = await quotaUsedToday(user.id);
  if (used >= DAILY_QUOTA) {
    const e = new Error(`Alcanzaste el límite de ${DAILY_QUOTA} canciones por día. Vuelve mañana.`);
    e.status = 429;
    throw e;
  }

  const { filename, size, mime } = req.body ?? {};
  validateUploadMeta({ filename, size, mime });

  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const rows = await sql`
    INSERT INTO stem_jobs (user_id, status, input_meta)
    VALUES (${user.id}, 'created', ${sql.json({ filename: safe, size, mime })})
    RETURNING id, status, created_at
  `;
  const job = rows[0];
  const inputPath = `${user.id}/${job.id}/input/${safe}`;
  await sql`UPDATE stem_jobs SET input_path = ${inputPath}, updated_at = now() WHERE id = ${job.id}`;

  const upload = await createStemsUploadUrl(inputPath);
  res.status(200).json({ job, upload });
});
