import sql from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { createPitchUploadUrl, deletePitchPrefix } from './_lib/storage.js';
import { DAILY_QUOTA, checkAccess, validateUploadMeta, sanitizeTitle } from './_lib/state.js';

async function quotaUsedToday(userId) {
  // Solo cuenta jobs que realmente entraron a procesamiento o terminaron OK.
  // created/uploaded/estimating/awaiting_approval abandonados no consumen cuota.
  const rows = await sql`
    SELECT count(*)::int AS n FROM pitch_jobs
    WHERE user_id = ${userId} AND status IN ('running','succeeded','partial')
      AND created_at >= date_trunc('day', now())
  `;
  return rows[0]?.n ?? 0;
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['POST', 'GET'])) return;
  const user = await requireUser(req);

  if (req.method === 'GET') {
    // jobs, cuota usada y perfil son lecturas independientes (dependen solo de
    // user.id, ya resuelto) → Promise.all.
    const [jobs, used, profileRows] = await Promise.all([
      sql`
        SELECT id, status, profile, input_meta, cost_estimate_lo, cost_estimate_hi,
               cost_actual, phases, artifacts, error, created_at, expires_at
        FROM pitch_jobs
        WHERE user_id = ${user.id} AND status <> 'expired'
          AND created_at > now() - interval '3 days'
        ORDER BY created_at DESC
      `,
      quotaUsedToday(user.id),
      sql`SELECT is_admin FROM profiles WHERE id = ${user.id}`,
    ]);
    const isAdmin = profileRows[0]?.is_admin ?? false;
    const quota = isAdmin ? { used, limit: null, unlimited: true } : { used, limit: DAILY_QUOTA };
    res.status(200).json({ jobs, quota });
    return;
  }

  // POST: crear job.
  // Verificar acceso beta antes de cualquier operación de escritura.
  const profileRows = await sql`SELECT is_admin, pitch_beta FROM profiles WHERE id = ${user.id}`;
  const profile = profileRows[0] ?? {};
  const access = checkAccess(profile);
  if (!access.ok) {
    res.status(403).json({ error: 'beta', reason: access.reason });
    return;
  }

  // Reclama intentos previos sin arrancar (created/uploaded/estimating/awaiting_approval):
  // no consumen cuota y, si quedaron huérfanos por una subida fallida, bloquearían nuevos
  // uploads hasta el cleanup. Los liberamos aquí para que el usuario reintente al instante.
  const stale = await sql`
    UPDATE pitch_jobs SET status = 'cancelled', error = 'Reemplazado por una nueva subida', updated_at = now()
    WHERE user_id = ${user.id} AND status IN ('created', 'uploaded', 'estimating', 'awaiting_approval')
    RETURNING id, input_path
  `;
  for (const j of stale) {
    if (j.input_path) await deletePitchPrefix(`${user.id}/${j.id}`).catch(() => {});
  }

  if (!profile.is_admin) {
    const used = await quotaUsedToday(user.id);
    if (used >= DAILY_QUOTA) {
      res.status(429).json({ error: 'quota', reason: 'quota' });
      return;
    }
  }

  const { filename, size, mime, title, profile: reqProfile } = req.body ?? {};
  validateUploadMeta({ filename, size, mime });
  const chosenProfile = reqProfile === 'precision' ? 'precision' : 'oss';
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const cleanTitle = sanitizeTitle(title, filename);

  let rows;
  try {
    rows = await sql`
      INSERT INTO pitch_jobs (user_id, status, profile, input_meta)
      VALUES (${user.id}, 'created', ${chosenProfile}, ${sql.json({ filename: safe, title: cleanTitle, size, mime })})
      RETURNING id, status, profile, created_at
    `;
  } catch (err) {
    // Igual que en stems/jobs.js: el índice único parcial pitch_jobs_one_active_per_user
    // rechaza el INSERT si ya hay un job activo (dos POST casi simultáneos pasaron el
    // check de arriba antes de que ninguno insertara). Se discrimina por constraint:
    // otra violación de unicidad (bug de esquema) no debe enmascararse como "cuota".
    if (err?.code === '23505' && err?.constraint_name === 'pitch_jobs_one_active_per_user') {
      res.status(429).json({ error: 'quota', reason: 'quota' });
      return;
    }
    throw err;
  }
  const job = rows[0];
  const inputPath = `${user.id}/${job.id}/input/${safe}`;
  await sql`UPDATE pitch_jobs SET input_path = ${inputPath}, updated_at = now() WHERE id = ${job.id}`;

  const upload = await createPitchUploadUrl(inputPath);
  res.status(200).json({ job, upload });
});
