import sql from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { createStemsUploadUrl, deleteStemsPrefix } from '../_lib/storage.js';
import { DAILY_QUOTA, validateUploadMeta, checkStudioAccess, sanitizeTitle } from '../_lib/stems.js';

async function quotaUsedToday(userId) {
  // Solo cuenta jobs que realmente entraron a procesamiento o terminaron OK.
  // created/uploaded abandonados no consumen cuota.
  const rows = await sql`
    SELECT count(*)::int AS n FROM stem_jobs
    WHERE user_id = ${userId}
      AND status IN ('processing', 'done', 'partial')
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
    const getProfileRows = await sql`SELECT is_admin FROM profiles WHERE id = ${user.id}`;
    const isAdmin = getProfileRows[0]?.is_admin ?? false;
    const quota = isAdmin ? { used, limit: null, unlimited: true } : { used, limit: DAILY_QUOTA };
    res.status(200).json({ jobs, quota });
    return;
  }

  // POST: crear job.
  // Verificar acceso beta antes de cualquier operación de escritura.
  const profileRows = await sql`SELECT is_admin, studio_beta FROM profiles WHERE id = ${user.id}`;
  const profile = profileRows[0] ?? {};
  const access = checkStudioAccess(profile);
  if (!access.ok) {
    res.status(403).json({ error: 'beta', reason: access.reason });
    return;
  }

  // Reclama intentos previos sin empezar (created/uploaded): no consumen cuota y, si
  // quedaron huérfanos por una subida fallida, bloquearían nuevos uploads hasta el
  // cleanup de 24 h. Los liberamos aquí para que el usuario pueda reintentar al instante.
  const stale = await sql`
    UPDATE stem_jobs SET status = 'failed', error = 'Reemplazado por una nueva subida', updated_at = now()
    WHERE user_id = ${user.id} AND status IN ('created', 'uploaded')
    RETURNING id, input_path
  `;
  for (const j of stale) {
    if (j.input_path) await deleteStemsPrefix(`${user.id}/${j.id}`).catch(() => {});
  }

  // Solo un job realmente en proceso bloquea uno nuevo. 'partial' es terminal
  // (unas secciones ok, otras fallidas; no llega más trabajo) → no bloquea.
  const active = await sql`
    SELECT id FROM stem_jobs
    WHERE user_id = ${user.id} AND status = 'processing'
    LIMIT 1
  `;
  if (active.length > 0) {
    const e = new Error('Ya tienes una canción en proceso. Espera a que termine.');
    e.status = 409;
    throw e;
  }

  if (!profile.is_admin) {
    const used = await quotaUsedToday(user.id);
    if (used >= DAILY_QUOTA) {
      res.status(429).json({ error: 'quota', reason: 'quota' });
      return;
    }
  }

  const { filename, size, mime, title } = req.body ?? {};
  validateUploadMeta({ filename, size, mime });

  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const cleanTitle = sanitizeTitle(title, filename);
  const rows = await sql`
    INSERT INTO stem_jobs (user_id, status, input_meta)
    VALUES (${user.id}, 'created', ${sql.json({ filename: safe, title: cleanTitle, size, mime })})
    RETURNING id, status, created_at
  `;
  const job = rows[0];
  const inputPath = `${user.id}/${job.id}/input/${safe}`;
  await sql`UPDATE stem_jobs SET input_path = ${inputPath}, updated_at = now() WHERE id = ${job.id}`;

  const upload = await createStemsUploadUrl(inputPath);
  res.status(200).json({ job, upload });
});
