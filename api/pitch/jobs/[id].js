import sql from '../../_lib/db.js';
import { requireUser } from '../../_lib/auth.js';
import { allowMethods, withErrors } from '../../_lib/http.js';
import { signPitchDownload } from '../_lib/storage.js';

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET'])) return;
  const user = await requireUser(req);
  const { id } = req.query;

  const rows = await sql`
    SELECT id, user_id, status, profile, input_meta, duration_sec, cost_estimate_lo, cost_estimate_hi,
           cost_actual, phases, artifacts, error, created_at, expires_at
    FROM pitch_jobs WHERE id = ${id} AND user_id = ${user.id}`;
  if (rows.length === 0) {
    res.status(404).json({ error: 'Job no encontrado' });
    return;
  }
  const job = rows[0];

  // Detalle progresivo: firma la descarga de cada artefacto ya producido (el pipeline
  // los va agregando fase a fase, no hay que esperar a succeeded para ver los primeros).
  // SEC: solo firmar storage_uri que pertenezcan al propio job (mismo guard que SEC-07 en
  // stems) — el webhook de Modal puebla artifacts con datos externos, y el bucket
  // pitch-jobs es compartido entre usuarios.
  const artifacts = Array.isArray(job.artifacts) ? job.artifacts : [];
  const prefix = `${job.user_id}/${job.id}/`;
  const signed = await Promise.all(
    artifacts.map(async (a) => {
      const withinPrefix = typeof a.storage_uri === 'string' && a.storage_uri.startsWith(prefix);
      let url = null;
      if (withinPrefix) {
        url = await signPitchDownload(a.storage_uri).catch((err) => {
          console.error(`No se pudo firmar el artefacto ${a.storage_uri}:`, err?.message ?? err);
          return null;
        });
      }
      return { ...a, url };
    }),
  );
  res.status(200).json({ ...job, artifacts: signed });
});
