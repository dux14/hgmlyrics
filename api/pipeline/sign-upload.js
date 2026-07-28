import sql from '../_lib/db.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { timingSafeEqualStr } from '../_lib/crypto.js';
import { createPitchSignedPutUrl } from '../pitch/_lib/storage.js';
import { ACTIVE_RUN_STATUSES, runIdFromJobId } from '../_lib/pipeline/process.js';

// Espejo de api/pitch/sign-upload.js para RUNS del pipeline unificado: el
// orquestador Modal hkn-pitch, cuando corre dentro de un run del pipeline,
// pasa jobId = song_pipeline_runs.id (no pitch_jobs.id, que no aplica aquí).
// Mismo secreto compartido y bucket de pitch; el prefijo pipeline/<songId>/
// <runId>/ evita colisionar con los jobs standalone (<user_id>/<jobId>/).
export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['POST'])) return;

  const secret = process.env.PITCH_MODAL_INBOUND_SECRET || '';
  const provided = req.headers['x-inbound-secret'] || '';
  if (!secret || !timingSafeEqualStr(provided, secret)) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }

  const { jobId, key } = req.body ?? {};
  if (!jobId || !key) {
    res.status(400).json({ error: 'jobId/key requeridos' });
    return;
  }

  // Los nodos de modal/pitch firman con el job_id que recibieron, que viene
  // versionado por ciclo de letra (`${runId}:${snapshotHash}`, ver
  // dispatchPitch). El sufijo no es parte del runId: sin quitarlo la consulta
  // reventaba con 22P02 contra la columna uuid y devolvía 500, matando el job
  // sin webhook (incidente 28-jul).
  const runId = runIdFromJobId(jobId);
  const rows = await sql`
    SELECT id, song_id AS "songId", status, phases FROM song_pipeline_runs WHERE id = ${runId}
  `;
  if (rows.length === 0) {
    res.status(404).json({ error: 'Run no encontrado' });
    return;
  }

  // Un run purgado (cancelled/superseded/done/failed) puede haber dejado
  // phases.pitch.status en 'running' si la purga corrió mientras Modal seguía
  // procesando (review holístico): sin este gate el signer seguía firmando
  // uploads para un run huérfano, agravando el leak de storage.
  if (!ACTIVE_RUN_STATUSES.has(rows[0].status)) {
    res.status(409).json({ error: 'El run no está activo' });
    return;
  }

  if (rows[0].phases?.pitch?.status !== 'running') {
    res.status(409).json({ error: 'La fase de tono no está en ejecución' });
    return;
  }

  if (!key.trim() || key.includes('..') || key.startsWith('/') || key.includes('//')) {
    res.status(400).json({ error: 'key inválida' });
    return;
  }

  // Prefijo por RUN, nunca por ciclo: api/songs/[id]/pipeline.js purga con
  // deletePitchPrefix(`pipeline/${songId}/${runId}`), así que versionar el
  // prefijo dejaría los artefactos huérfanos en el bucket. Reescribir el ciclo
  // anterior es el comportamiento buscado (createPitchSignedPutUrl usa upsert).
  const fullKey = `pipeline/${rows[0].songId}/${runId}/${key}`;
  const url = await createPitchSignedPutUrl(fullKey);
  res.status(200).json({ url });
});
