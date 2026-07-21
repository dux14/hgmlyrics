// Confirma la subida directa del mp3 completo de un run 'created' (spec Task
// B2): valida que el objeto exista en Storage y no exceda el límite, marca la
// fase 'upload' como done, pasa el run a 'processing' y despacha 'stems'.
import sql from '../../../_lib/db.js';
import { requireAdmin } from '../../../_lib/auth.js';
import { allowMethods, withErrors } from '../../../_lib/http.js';
import { pipelineInputStat } from '../../../_lib/storage.js';
import { applyPhaseEvent } from '../../../_lib/pipeline/state.js';
import { dispatchPhase } from './_dispatch.js';

const MAX_INPUT_BYTES = 25 * 1024 * 1024; // 25MB

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['POST'])) return;
  await requireAdmin(req, sql);
  const songId = req.query.id;
  if (!songId || typeof songId !== 'string') {
    res.status(400).json({ error: 'id es obligatorio' });
    return;
  }

  const rows = await sql`
    SELECT id, song_id AS "songId", status, phases, input_path AS "inputPath"
    FROM song_pipeline_runs
    WHERE song_id = ${songId} AND status = 'created'
    ORDER BY created_at DESC LIMIT 1
  `;
  if (rows.length === 0) {
    res.status(404).json({ error: 'No hay una ejecución pendiente de confirmar' });
    return;
  }
  const run = rows[0];

  // Chequeo server-side: el PUT firmado no rechaza por sí solo un archivo que
  // supere el límite, y el cliente pudo cancelar la subida a mitad de camino.
  const stat = await pipelineInputStat(run.inputPath);
  if (!stat.exists) {
    res.status(422).json({ error: 'El archivo no existe en el almacenamiento' });
    return;
  }
  if (stat.size !== null && stat.size > MAX_INPUT_BYTES) {
    res.status(422).json({ error: 'El archivo excede el límite de 25MB' });
    return;
  }

  // 'upload' arranca en 'running' (initialPhases) y nunca es terminal antes de
  // este punto, así que applyPhaseEvent nunca devuelve null aquí.
  const phases = applyPhaseEvent(run.phases, { phase: 'upload', ok: true });

  // CAS: solo confirma si el run sigue en 'created' (cierra la carrera de
  // doble-confirm/doble-dispatch, mismo criterio que audio.js/approve.js).
  const claimed = await sql`
    UPDATE song_pipeline_runs SET status = 'processing', phases = ${sql.json(phases)}, updated_at = now()
    WHERE id = ${run.id} AND status = 'created'
  `;
  if (claimed.count === 0) {
    res.status(409).json({ error: 'La ejecución ya fue confirmada' });
    return;
  }

  // Dispatch aislado con 1 reintento (mismo patrón que pitch/jobs/[id]/approve.js).
  try {
    await dispatchPhase('stems', { ...run, phases });
  } catch (_err1) {
    try {
      await dispatchPhase('stems', { ...run, phases });
    } catch (err2) {
      // Decisión (carry del review plan A): runStatusFromPhases NO deriva
      // 'failed' global — el run se queda 'processing' (retry-able vía
      // retry.js) y SOLO la fase 'stems' pasa a failed. No hay auto-failed
      // de todo el run: sería YAGNI y además rompería el reintento sin volver
      // a subir el archivo.
      const failedPhases = applyPhaseEvent(phases, {
        phase: 'stems',
        ok: false,
        error: String(err2?.message ?? err2).slice(0, 300),
      });
      await sql`
        UPDATE song_pipeline_runs SET phases = ${sql.json(failedPhases)}, updated_at = now()
        WHERE id = ${run.id}
      `;
      const e = new Error('No se pudo iniciar el procesamiento. Intenta de nuevo.');
      e.status = 502;
      throw e;
    }
  }
  res.status(200).json({ success: true });
});
