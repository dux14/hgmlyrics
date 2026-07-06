import sql from '../../../_lib/db.js';
import { requireUser } from '../../../_lib/auth.js';
import { allowMethods, withErrors } from '../../../_lib/http.js';
import { signPitchDownload, deletePitchPrefix } from '../../_lib/storage.js';
import { invokePitchPipeline } from '../../_lib/modal.js';
import { choirEnabled } from '../../_lib/state.js';

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['POST'])) return;
  const user = await requireUser(req);
  const { id } = req.query;

  const rows =
    await sql`SELECT id, user_id, status, profile, input_path FROM pitch_jobs WHERE id = ${id} AND user_id = ${user.id}`;
  if (rows.length === 0) {
    res.status(404).json({ error: 'Job no encontrado' });
    return;
  }
  const job = rows[0];
  if (job.status !== 'awaiting_approval') {
    res.status(409).json({ error: `No se puede aprobar en estado ${job.status}` });
    return;
  }

  // Reclama la transición con compare-and-swap: persiste 'running' ANTES de despachar
  // y cierra la carrera de doble-approve (solo un llamador gana → un solo dispatch pagado).
  const claimed = await sql`
    UPDATE pitch_jobs SET status = 'running', updated_at = now()
    WHERE id = ${id} AND status = 'awaiting_approval'`;
  if (claimed.count !== 1) {
    res.status(409).json({ error: 'El job ya fue aprobado o cambió de estado' });
    return;
  }

  const getUrl = await signPitchDownload(job.input_path);
  const payload = {
    jobId: job.id,
    profile: job.profile,
    input: { getUrl },
    uploads: {}, // Modal firma sus propios PUT vía endpoint dedicado en M1.
    signUploadUrl: `${process.env.PUBLIC_BASE_URL}/api/pitch/sign-upload`,
    webhook: { url: `${process.env.PUBLIC_BASE_URL}/api/pitch/webhook` },
    flags: { choir: choirEnabled() },
  };

  // Dispatch aislado con 1 reintento; si falla, marcar failed (no dejar colgado en running).
  try {
    await invokePitchPipeline(payload);
  } catch (_err1) {
    try {
      await invokePitchPipeline(payload);
    } catch (err2) {
      // CAS sobre 'running': esta rama solo parte de running, así que el estado
      // fijo en el WHERE es seguro. Si ya cambió (p.ej. cancelado durante el
      // despacho), no lo pisamos a failed ni lanzamos 502.
      const marked = await sql`
        UPDATE pitch_jobs SET status = 'failed', error = ${String(err2?.message ?? err2).slice(0, 300)}, updated_at = now()
        WHERE id = ${id} AND status = 'running'`;
      if (marked.count === 1) {
        await deletePitchPrefix(`${user.id}/${id}`).catch(() => {}); // #3: liberar storage del job fallido
        const e = new Error('No se pudo iniciar el procesamiento. Intenta de nuevo.');
        e.status = 502;
        throw e;
      }
      res.status(409).json({ error: 'El job cambió de estado durante el despacho' });
      return;
    }
  }
  res.status(202).json({ status: 'running' });
});
